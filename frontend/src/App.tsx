import React, { useState } from 'react';

const API_BASE = 'https://nfcw3hrelc.execute-api.us-east-1.amazonaws.com/prod/';

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState('Idle');
  const [result, setResult] = useState<any>(null);
  const [showDetailedAnalysis, setShowDetailedAnalysis] = useState(false);
  const [tonnage, setTonnage] = useState('1.5');
  const [starRating, setStarRating] = useState('5');
  const [dailyHours, setDailyHours] = useState('5');
  const [baseHouseholdUnits, setBaseHouseholdUnits] = useState('170');

  const handleCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.currentTarget.files?.[0];
    if (!selectedFile) return;

    setStatus('Compressing image...');
    const imageUrl = URL.createObjectURL(selectedFile);

    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('Could not load the selected image'));
        image.src = imageUrl;
      });

      const scale = Math.min(1, 1024 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not prepare image compression');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      const jpegBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Could not compress the selected image'));
          },
          'image/jpeg',
          0.7,
        );
      });

      const baseName = selectedFile.name.replace(/\.[^.]+$/, '') || 'ac-unit';
      setFile(new File([jpegBlob], `${baseName}.jpg`, { type: 'image/jpeg' }));
      setStatus('Image ready');
    } catch (error) {
      console.error(error);
      setFile(null);
      setStatus(`Error: ${(error as Error).message}`);
    } finally {
      URL.revokeObjectURL(imageUrl);
    }
  };

  const analyzeAC = async () => {
    if (!file) return;
    setStatus('Getting secure upload link...');
    setResult(null);

    try {
      // 1. Get S3 Presigned URL
      const urlRes = await fetch(`${API_BASE}upload-url`, { method: 'POST' });
      if (!urlRes.ok) throw new Error('Failed to get upload URL');
      const { uploadUrl, fileName } = await urlRes.json();

      // 2. Upload directly to S3
      setStatus('Uploading image to AWS...');
      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!uploadRes.ok) throw new Error('S3 Upload Failed');

      // 3. Trigger Bedrock Analysis
      setStatus('Analyzing thermal clearance...');
      const analyzeRes = await fetch(`${API_BASE}analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName,
          tonnage: Number(tonnage),
          starRating: Number(starRating),
          dailyHours: Number(dailyHours),
          baseHouseholdUnits: Number(baseHouseholdUnits),
        }),
      });
      if (!analyzeRes.ok) {
        const errData = await analyzeRes.json();
        throw new Error(`AWS Backend: ${errData.error}`);
      }
      const data = await analyzeRes.json();

      setResult(data);
      setShowDetailedAnalysis(false);
      setStatus('Complete');
    } catch (err: any) {
      console.error(err);
      setStatus(`Error: ${err.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6 flex flex-col items-center">
      <h1 className="text-3xl font-bold mb-8 tracking-wider">AERO-AUDIT</h1>
      <div className="w-full max-w-md bg-gray-800 rounded-xl p-6 shadow-2xl border border-gray-700">
        <div className="grid grid-cols-2 gap-4 mb-5">
          <label className="text-sm text-gray-300">
            AC capacity (tons)
            <input
              type="number"
              min="0.1"
              step="0.1"
              value={tonnage}
              onChange={(event) => setTonnage(event.target.value)}
              className="mt-1 w-full rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-white"
            />
          </label>
          <label className="text-sm text-gray-300">
            BEE star rating
            <select
              value={starRating}
              onChange={(event) => setStarRating(event.target.value)}
              className="mt-1 w-full rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-white"
            >
              {[5, 4, 3, 2, 1].map((rating) => (
                <option key={rating} value={rating}>{rating} star</option>
              ))}
            </select>
          </label>
          <label className="text-sm text-gray-300">
            Daily usage (hours)
            <input
              type="number"
              min="0"
              max="24"
              step="0.1"
              value={dailyHours}
              onChange={(event) => setDailyHours(event.target.value)}
              className="mt-1 w-full rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-white"
            />
          </label>
          <label className="text-sm text-gray-300">
            Base household units
            <input
              type="number"
              min="0"
              step="1"
              value={baseHouseholdUnits}
              onChange={(event) => setBaseHouseholdUnits(event.target.value)}
              className="mt-1 w-full rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-white"
            />
          </label>
        </div>

        <label className="block mb-4">
          <span className="sr-only">Choose AC photo</span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleCapture}
            className="block w-full text-sm text-gray-400 file:mr-4 file:py-3 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-bold file:bg-blue-600 file:text-white hover:file:bg-blue-500 cursor-pointer"
          />
        </label>

        <button
          onClick={analyzeAC}
          disabled={!file || status.includes('ing...')}
          className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-4 px-4 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {status.includes('ing...') ? 'Processing...' : 'Run Diagnostics'}
        </button>

        <div className="mt-6 text-left">
          <p className="text-gray-400 text-sm mb-2">
            System Status: <span className="text-blue-400 font-mono">{status}</span>
          </p>

          {result && (
            <div className="mt-4 p-5 rounded-lg border border-emerald-500 bg-emerald-950/40">
              <h2 className="text-2xl font-black mb-2 text-emerald-400">Clearance Analysis</h2>
              <div className="space-y-1 font-mono text-sm text-gray-300">
                <p>
                  ESTIMATED_CLEARANCE:{' '}
                  <span className="text-white font-bold">{result.estimated_clearance_meters} m</span>
                </p>
                <p>
                  OBSTRUCTION_TYPE:{' '}
                  <span className="text-white font-bold">{result.obstruction_type}</span>
                </p>
                <p>
                  EFFICIENCY_PENALTY:{' '}
                  <span className="text-white font-bold">
                    {(result.efficiency_penalty_pct * 100).toFixed(0)}%
                  </span>
                </p>
                <p>
                  DEGRADED_AC_UNITS:{' '}
                  <span className="text-white font-bold">{result.degraded_ac_units}</span>
                </p>
                <p>
                  WASTED_AC_UNITS:{' '}
                  <span className="text-white font-bold">{result.wasted_units}</span>
                </p>
                <p>
                  TOTAL_HOUSEHOLD_UNITS:{' '}
                  <span className="text-white font-bold">{result.total_units}</span>
                </p>
                <p>
                  BI-MONTHLY_BILL:{' '}
                  <span className="text-white font-bold">₹{result.bill_amount.toFixed(2)}</span>
                </p>
                <p>
                  OPTIMAL_BILL:{' '}
                  <span className="text-white font-bold">₹{result.optimal_bill.toFixed(2)}</span>
                </p>
                <p>
                  FINANCIAL_PENALTY:{' '}
                  <span className="text-white font-bold">₹{result.financial_penalty.toFixed(2)}</span>
                </p>
                {result.wasted_units > 0 && (
                  <p className="text-red-400 font-bold mt-4">
                    VIOLATION: If standard clearance was met, you could have saved {result.wasted_units} units of electricity.
                  </p>
                )}
                {result.wasted_units === 0 && (
                  <p className="text-emerald-400 font-bold mt-4">
                    OPTIMAL: Your AC geometry is efficient and does not create excess thermal grid strain.
                  </p>
                )}
                {result.estimated_clearance_meters < 1.0 &&
                  result.obstruction_type.toLowerCase().includes('wall') && (
                    <div className="bg-orange-950/40 border border-orange-500 p-4 mt-4 rounded-md">
                      <h3 className="font-bold text-orange-400">ENGINEERING REMEDIATION</h3>
                      <p className="mt-2">
                        Physical relocation is constrained by the solid wall. We strongly recommend
                        installing a 45-degree aerodynamic condenser air deflector. This lower will
                        vector the 50°C exhaust upward, permanently breaking the thermal
                        short-circuit, restoring cooling capacity, and eliminating your ₹
                        {result.financial_penalty.toFixed(2)} TANGEDCO penalty.
                      </p>
                    </div>
                  )}
                <button
                        onClick={() => setShowDetailedAnalysis(!showDetailedAnalysis)}
                        className="w-full mt-4 bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-md transition-colors"
                >
                        {showDetailedAnalysis ? 'Hide Detailed Analysis' : 'Detailed Analysis'}
                </button>
                {showDetailedAnalysis && (
                        <div className="mt-4 p-4 rounded-md bg-gray-900 border border-gray-700 text-sm space-y-3 font-mono text-gray-300">
                          <p>
                            <strong className="text-white">Estimated Clearance &amp; Obstruction:</strong>{' '}
                            The model used the 800mm fan grate as a reference to estimate{' '}
                            {result.estimated_clearance_meters} meters of clearance against a{' '}
                            {result.obstruction_type}.
                          </p>
                          <p>
                            <strong className="text-white">Efficiency Penalty:</strong>{' '}
                            The clearance threshold tier applies an efficiency penalty of{' '}
                            {(result.efficiency_penalty_pct * 100).toFixed(0)}%.
                          </p>
                          <p>
                            <strong className="text-white">Degraded vs. Wasted Units:</strong>{' '}
                            Estimated from a {tonnage}-ton, {starRating}-star AC running {dailyHours} hours
                            per day for 60 days. This yields {result.degraded_ac_units} total AC units, of
                            which {result.wasted_units} units are wasted due to clearance degradation.
                          </p>
                          <p>
                            <strong className="text-white">TANGEDCO Billing &amp; Financial Penalty:</strong>{' '}
                            The cumulative household load is {result.total_units} units, billed using
                            telescopic tariff tiers. The optimal bill is ₹{result.optimal_bill.toFixed(2)},
                            resulting in a financial penalty of ₹{result.financial_penalty.toFixed(2)}.
                          </p>
                          <p>
                            <strong className="text-white">Engineering Remediation:</strong>{' '}
                            {result.estimated_clearance_meters < 1.0 &&
                            result.obstruction_type.toLowerCase().includes('wall')
                              ? 'Because clearance is below 1.0 meter and the obstruction is a wall, a 45-degree louver is recommended to redirect exhaust away from the obstruction.'
                              : 'The 45-degree louver recommendation applies when clearance is below 1.0 meter and the obstruction is identified as a wall.'}
                          </p>
                        </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
