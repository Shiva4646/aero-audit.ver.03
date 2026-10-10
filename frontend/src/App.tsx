import React, { useState } from 'react';

const API_BASE = 'https://nfcw3hrelc.execute-api.us-east-1.amazonaws.com/prod/';

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState('Idle');
  const [result, setResult] = useState<any>(null);

  const handleCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
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
        body: JSON.stringify({ fileName }),
      });
      if (!analyzeRes.ok) {
        const errData = await analyzeRes.json();
        throw new Error(`AWS Backend: ${errData.error}`);
      }
      const data = await analyzeRes.json();

      setResult(data);
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
            <div
              className={`mt-4 p-5 rounded-lg border ${result.clearance === '<1m' ? 'border-red-500 bg-red-950/40' : 'border-emerald-500 bg-emerald-950/40'}`}
            >
              <h2
                className={`text-2xl font-black mb-2 ${result.clearance === '<1m' ? 'text-red-400' : 'text-emerald-400'}`}
              >
                {result.verdict}
              </h2>
              <div className="space-y-1 font-mono text-sm text-gray-300">
                <p>
                  EST_CLEARANCE: <span className="text-white font-bold">{result.clearance}</span>
                </p>
                <p>
                  TANGEDCO_PENALTY: <span className="text-white font-bold">₹{result.penalty_inr}</span>
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
