import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { GoogleGenAI, Type } from "@google/genai";

const s3 = new S3Client({});

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-3.5-flash-lite";

export function calculateTangedcoBill(totalUnits: number): number {
  if (!Number.isFinite(totalUnits) || totalUnits < 0) {
    throw new Error("totalUnits must be a non-negative number");
  }

  const tiers = totalUnits <= 500
    ? [
        { upTo: 200, rate: 0 },
        { upTo: 400, rate: 4.7 },
        { upTo: 500, rate: 6.3 },
      ]
    : [
        { upTo: 100, rate: 0 },
        { upTo: 400, rate: 4.7 },
        { upTo: 500, rate: 6.3 },
        { upTo: 600, rate: 8.4 },
        { upTo: 800, rate: 9.45 },
        { upTo: Infinity, rate: 11.25 },
      ];

  let energyCharge = 0;
  let previousTierLimit = 0;
  for (const tier of tiers) {
    const unitsInTier = Math.max(0, Math.min(totalUnits, tier.upTo) - previousTierLimit);
    energyCharge += unitsInTier * tier.rate;
    previousTierLimit = tier.upTo;
    if (totalUnits <= tier.upTo) break;
  }

  return Number((energyCharge + 75).toFixed(2));
}

export const handler = async (event: any) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const fileName = body.fileName;
    if (!fileName) return { statusCode: 400, body: "Missing fileName" };

    const { tonnage, starRating, dailyHours, baseHouseholdUnits } = body;
    if (
      typeof tonnage !== "number" || !Number.isFinite(tonnage) || tonnage <= 0 ||
      typeof starRating !== "number" || !Number.isInteger(starRating) || starRating < 1 || starRating > 5 ||
      typeof dailyHours !== "number" || !Number.isFinite(dailyHours) || dailyHours < 0 || dailyHours > 24 ||
      typeof baseHouseholdUnits !== "number" || !Number.isFinite(baseHouseholdUnits) || baseHouseholdUnits < 0
    ) {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          error: "Provide valid tonnage, starRating (1-5), dailyHours (0-24), and non-negative baseHouseholdUnits",
        }),
      };
    }

    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured on the Lambda environment");

    // 1. Download image from S3
    const s3Response = await s3.send(new GetObjectCommand({
      Bucket: process.env.BUCKET_NAME,
      Key: fileName
    }));
    const imageBytes = await s3Response.Body?.transformToByteArray();
    if (!imageBytes) throw new Error("Could not extract image bytes");

    // 2. Convert to Base64 for the API
    const base64Image = Buffer.from(imageBytes).toString('base64');

    // 3. Google Gemini Vision
    const genAI = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const geminiResponse = await genAI.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{
        role: "user",
        parts: [
          {
            text: "Analyze the spatial geometry and surroundings of this AC outdoor unit. Determine if an outdoor AC unit is present (`is_ac_unit`), estimate clearance in meters, identify the obstruction type, and generate a customized, practical engineering remediation strategy tailored specifically to the visual context of this photo (e.g., specific deflection angles, directional exhaust routing, or clearance adjustments).",
          },
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Image,
            },
          },
        ],
      }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            is_ac_unit: { type: Type.BOOLEAN },
            estimated_clearance_meters: { type: Type.NUMBER },
            obstruction_type: { type: Type.STRING },
            engineering_remediation: { type: Type.STRING },
          },
          required: [
            "is_ac_unit",
            "estimated_clearance_meters",
            "obstruction_type",
            "engineering_remediation",
          ],
        },
      },
    });

    const responseText = geminiResponse.text;
    if (!responseText) {
      throw new Error("Gemini API response did not contain an analysis result");
    }

    const analysisResult: Record<string, unknown> = JSON.parse(responseText);
    if (!analysisResult.is_ac_unit) {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          error: "Invalid image: No outdoor AC condenser unit detected. Please upload a valid AC unit photo.",
        }),
      };
    }

    const clearanceMeters = analysisResult.estimated_clearance_meters;
    if (typeof clearanceMeters !== "number" || !Number.isFinite(clearanceMeters) || clearanceMeters < 0) {
      throw new Error("Gemini response must include a non-negative estimated_clearance_meters value");
    }

    let efficiencyPenaltyPct: number;
    if (clearanceMeters >= 1.5) {
      efficiencyPenaltyPct = 0;
    } else if (clearanceMeters >= 1.0) {
      efficiencyPenaltyPct = 0.05;
    } else if (clearanceMeters >= 0.5) {
      efficiencyPenaltyPct = 0.15;
    } else {
      efficiencyPenaltyPct = 0.25;
    }

    const base15StarConsumptionKwh: Record<number, number> = {
      1: 1.75,
      2: 1.55,
      3: 1.37,
      4: 1.20,
      5: 1.05,
    };
    const base15Kwh = base15StarConsumptionKwh[starRating];
    const actualBaseKwh = base15Kwh * (tonnage / 1.5);
    const optimalAcUnits = actualBaseKwh * dailyHours * 60;
    const roundedOptimalAcUnits = Math.round(optimalAcUnits);
    const degradedAcUnits = Math.round(optimalAcUnits * (1 + efficiencyPenaltyPct));
    const wastedUnits = degradedAcUnits - roundedOptimalAcUnits;
    const totalUnits = baseHouseholdUnits + degradedAcUnits;
    const billAmount = calculateTangedcoBill(totalUnits);
    const optimalBill = calculateTangedcoBill(baseHouseholdUnits + roundedOptimalAcUnits);
    const financialPenalty = Number((billAmount - optimalBill).toFixed(2));
    Object.assign(analysisResult, {
      efficiency_penalty_pct: efficiencyPenaltyPct,
      actual_base_kwh: actualBaseKwh,
      optimal_ac_units: optimalAcUnits,
      degraded_ac_units: degradedAcUnits,
      wasted_units: wastedUnits,
      total_units: totalUnits,
      bill_amount: billAmount,
      optimal_bill: optimalBill,
      financial_penalty: financialPenalty,
    });

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(analysisResult),
    };
  } catch (error) {
    console.error(error);
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: (error as Error).message })
    };
  }
};