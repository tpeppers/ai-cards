import React, { useState } from 'react';

interface BidInfo {
  playerId: number;
  amount: number;
  passed: boolean;
}

interface BiddingOverlayProps {
  isYourTurn: boolean;
  currentHighBid: number;
  validBids: number[];
  bids: BidInfo[];
  playerNames: string[];
  dealer: number;
  currentBidder: number | null;
  onBid: (amount: number) => void;
}

const BiddingOverlay: React.FC<BiddingOverlayProps> = ({
  isYourTurn,
  currentHighBid,
  validBids,
  bids,
  playerNames,
  dealer,
  currentBidder,
  onBid
}) => {
  // Default to pass (0) - user can select a higher bid if they want
  const [selectedBid, setSelectedBid] = useState<number>(0);

  const getBidLabel = (amount: number): string => {
    if (amount === 0) return 'Pass';
    if (amount === -1) return 'Take It';
    return amount.toString();
  };

  const handleSubmitBid = () => {
    onBid(selectedBid);
  };

  return (
    <div className="absolute inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-2xl p-6 max-w-md w-full mx-4">
        <h2 className="text-2xl font-bold text-center mb-2 text-gray-800">Bidding Phase</h2>
        <p className="text-center text-gray-500 text-sm mb-4">
          {playerNames[dealer]} is dealing
        </p>

        {/* Current bid info */}
        <div className="bg-gray-100 rounded p-3 mb-4">
          <div className="text-center">
            <span className="text-gray-600">Current High Bid: </span>
            <span className="font-bold text-xl text-blue-600">
              {currentHighBid > 0 ? currentHighBid : 'None'}
            </span>
          </div>
        </div>

        {/* Bid history */}
        {bids.length > 0 && (
          <div className="mb-4">
            <h3 className="font-semibold text-gray-700 mb-2">Bids So Far:</h3>
            <div className="space-y-1">
              {bids.map((bid, index) => (
                <div key={index} className="flex justify-between text-sm bg-gray-50 px-3 py-1 rounded">
                  <span>{playerNames[bid.playerId]}</span>
                  <span className={bid.passed ? 'text-gray-500' : 'text-green-600 font-semibold'}>
                    {bid.passed ? 'Passed' : bid.amount}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Bidding controls */}
        {isYourTurn ? (
          <div className="space-y-4">
            {/* Show dealer hint when "Take It" is available */}
            {validBids.includes(-1) && (
              <div className="bg-yellow-50 border border-yellow-200 rounded p-2 text-sm text-yellow-800">
                As dealer, you can "Take It" to claim the current bid without raising!
              </div>
            )}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Your Bid:
              </label>
              <select
                value={selectedBid}
                onChange={(e) => setSelectedBid(Number(e.target.value))}
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-lg"
              >
                {validBids.map(bid => (
                  <option key={bid} value={bid}>
                    {getBidLabel(bid)}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={handleSubmitBid}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg transition-colors"
            >
              {selectedBid === 0 ? 'Pass' : selectedBid === -1 ? 'Take It' : `Bid ${selectedBid}`}
            </button>
          </div>
        ) : (
          <div className="text-center py-4">
            <div className="text-gray-600">
              <span className="animate-pulse">Waiting for </span>
              <span className="font-semibold">{currentBidder !== null ? playerNames[currentBidder] : '...'}</span>
              <span className="animate-pulse"> to bid...</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BiddingOverlay;
