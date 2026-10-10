import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { GoogleGenAI } from "@google/genai";

const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-3.8-flash";

export const handler = async (event: any) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const fileName = body.fileName;
    if (!fileName) return { statusCode: 400, body: "Missing fileName" };
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
            text: "You are an AI auditor for TANGEDCO. Analyze this AC unit installation. Estimate the clearance between the exhaust fan and the nearest wall/obstruction. If the clearance is severely restricted (less than 1 meter), respond with exactly '<1m'. If there is plenty of breathing room, respond with '>1m'. Do not output any other text.",
          },
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Image,
            },
          },
        ],
      }],
    });

    const clearanceBracket = geminiResponse.text?.trim();
    if (!clearanceBracket) {
      throw new Error("Gemini API response did not contain an analysis result");
    }

    // 4. Penalty Lookup
    let penaltyAmount = 0;
    try {
        const dbRes = await ddb.send(new GetCommand({
            TableName: process.env.TABLE_NAME,
            Key: { clearance_bracket: clearanceBracket }
        }));
        penaltyAmount = dbRes.Item?.penalty_amount || 0;
    } catch (e) {
        console.log("DynamoDB lookup bypassed/failed", e);
    }

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        clearance: clearanceBracket,
        penalty_inr: penaltyAmount,
        verdict: clearanceBracket === "<1m" ? "FAIL: Thermal Short-Circuit Detected" : "PASS: Adequate Clearance"
      })
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