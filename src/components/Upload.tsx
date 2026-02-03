import React, { useState, useCallback } from 'react';

interface DetectionResult {
  cards: string[];
  count: number;
  detections: { name: string; confidence: number; bbox?: number[] }[];
  detectionId?: string;
  imageWidth?: number;
  imageHeight?: number;
}

const suitInfo: Record<string, { symbol: string; color: string }> = {
  d: { symbol: '♦', color: '#f97316' }, // orange
  s: { symbol: '♠', color: '#000000' }, // black
  h: { symbol: '♥', color: '#dc2626' }, // red
  c: { symbol: '♣', color: '#16a34a' }, // green
};

const formatCard = (card: string): { rank: string; suit: string; color: string } => {
  const rank = card.slice(0, -1).toUpperCase();
  const suitChar = card.slice(-1).toLowerCase();
  const info = suitInfo[suitChar] || { symbol: suitChar, color: '#000000' };
  return { rank, suit: info.symbol, color: info.color };
};

const CardDisplay: React.FC<{ card: string; className?: string }> = ({ card, className = '' }) => {
  const { rank, suit, color } = formatCard(card);
  return (
    <span className={className} style={{ color }}>
      {rank}{suit}
    </span>
  );
};

const Upload: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DetectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReporting, setIsReporting] = useState(false);
  const [labelStudioUrl, setLabelStudioUrl] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setResult(null);
      setError(null);

      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      setSelectedFile(file);
      setResult(null);
      setError(null);

      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  }, []);

  const handleUpload = async () => {
    if (!selectedFile) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('image', selectedFile);

      const response = await fetch('/api/detect', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Detection failed');
      }

      const data = await response.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Detection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setSelectedFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setLabelStudioUrl(null);
    setReportError(null);
  };

  const handleReportIncorrect = async () => {
    if (!result?.detectionId) return;

    setIsReporting(true);
    setReportError(null);
    setLabelStudioUrl(null);

    try {
      const response = await fetch('/api/label-studio/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ detectionId: result.detectionId }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.setupRequired) {
          setReportError('Label Studio needs to be configured. Run Label Studio and set up with your API key.');
        } else {
          setReportError(data.error || 'Failed to report');
        }
        return;
      }

      setLabelStudioUrl(data.taskUrl);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : 'Failed to report');
    } finally {
      setIsReporting(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Card Detection</h1>

      <div className="flex gap-6 items-start">
        {/* Left column - Image */}
        <div className="flex-1 min-w-0">
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            className="border-2 border-dashed border-gray-400 rounded-lg p-8 text-center hover:border-blue-500 transition-colors cursor-pointer"
            onClick={() => document.getElementById('file-input')?.click()}
          >
            {preview ? (
              <img src={preview} alt="Preview" className="mx-auto object-contain max-w-full max-h-[480px]" />
            ) : (
              <div className="text-gray-500">
                <p className="text-lg mb-2">Drop an image here or click to select</p>
                <p className="text-sm">Supports JPG, PNG</p>
              </div>
            )}
            <input
              id="file-input"
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>
        </div>

        {/* Right column - Controls and Results */}
        <div className="flex-1 min-w-0">
          {!selectedFile && (
            <div className="text-gray-400 text-center p-8">
              Select an image to detect cards
            </div>
          )}

          {selectedFile && (
            <>
              <div className="flex gap-4 mb-4">
                <button
                  onClick={handleUpload}
                  disabled={loading}
                  className="flex-1 bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? 'Detecting...' : 'Detect Cards'}
                </button>
                <button
                  onClick={handleClear}
                  className="bg-gray-600 text-white py-2 px-4 rounded hover:bg-gray-700 transition-colors"
                >
                  Clear
                </button>
              </div>

              {error && (
                <div className="p-4 bg-red-100 text-red-700 rounded mb-4">
                  {error}
                </div>
              )}

              {result && (
                <>
                  <div className="bg-green-100 p-4 rounded mb-4">
                    <h2 className="text-xl font-semibold mb-2">
                      Detected {result.count} cards
                    </h2>
                    <p className="text-2xl font-mono bg-white p-3 rounded border">
                      {result.cards.map((card, i) => (
                        <span key={i}>
                          {i > 0 && ', '}
                          <CardDisplay card={card} className="font-bold" />
                        </span>
                      ))}
                    </p>
                  </div>

                  <div className="bg-gray-100 p-4 rounded mb-4">
                    <h3 className="font-semibold mb-2">Detection Details:</h3>
                    <div className="grid grid-cols-2 gap-2">
                      {result.detections.map((det, i) => (
                        <div key={i} className="bg-white p-2 rounded text-center">
                          <CardDisplay card={det.name} className="font-mono font-bold" />
                          <span className="text-gray-500 text-sm ml-1">
                            ({Math.round(det.confidence * 100)}%)
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="p-4 bg-gray-50 rounded border">
                    <h3 className="font-semibold mb-2">Results not correct?</h3>
                    {labelStudioUrl ? (
                      <div className="bg-blue-50 p-3 rounded">
                        <p className="text-sm mb-2">Task created! Click to correct labels in Label Studio:</p>
                        <a
                          href={labelStudioUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline break-all"
                        >
                          {labelStudioUrl}
                        </a>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={handleReportIncorrect}
                          disabled={isReporting || !result.detectionId}
                          className="bg-orange-500 text-white py-2 px-4 rounded hover:bg-orange-600 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                        >
                          {isReporting ? 'Creating task...' : 'Report Incorrect'}
                        </button>
                        <p className="text-sm text-gray-500 mt-2">
                          Opens Label Studio to correct the card labels for model improvement
                        </p>
                      </>
                    )}
                    {reportError && (
                      <div className="mt-2 p-2 bg-red-100 text-red-700 rounded text-sm">
                        {reportError}
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Upload;
