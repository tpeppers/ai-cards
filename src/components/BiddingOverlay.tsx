import React, { useState } from 'react';
import { useResponsiveLayout } from '../hooks/useResponsiveLayout.ts';

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
  previewBid?: number | null;
}

const BiddingOverlay: React.FC<BiddingOverlayProps> = ({
  isYourTurn,
  currentHighBid,
  validBids,
  bids,
  playerNames,
  dealer,
  currentBidder,
  onBid,
  previewBid
}) => {
  // Default to pass (0) - user can select a higher bid if they want
  const [selectedBid, setSelectedBid] = useState<number>(0);
  const { isCompact, isLandscape } = useResponsiveLayout();

  const getBidLabel = (amount: number): string => {
    if (amount === 0) return 'Pass';
    if (amount === -1) return 'Take It';
    return amount.toString();
  };

  const handleSubmitBid = () => {
    onBid(selectedBid);
  };

  return (
    <div className="absolute inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-2">
      <div
        className={`bg-white rounded-lg shadow-2xl w-full max-w-md overflow-y-auto ${
          isLandscape ? 'p-2 max-h-[95vh]' : isCompact ? 'p-3 max-h-[90vh]' : 'p-6'
        }`}
      >
        <h2 className={`font-bold text-center text-gray-800 ${isCompact ? 'text-lg mb-1' : 'text-2xl mb-2'}`}>Bidding Phase</h2>
        <p className={`text-center text-gray-500 ${isCompact ? 'text-xs mb-2' : 'text-sm mb-4'}`}>
          {playerNames[dealer]} is dealing
        </p>

        {/* Current bid info */}
        <div className={`bg-gray-100 rounded ${isCompact ? 'p-1 mb-2' : 'p-3 mb-4'}`}>
          <div className="text-center">
            <span className={`text-gray-600 ${isCompact ? 'text-xs' : ''}`}>Current High Bid: </span>
            <span className={`font-bold text-blue-600 ${isCompact ? 'text-base' : 'text-xl'}`}>
              {currentHighBid > 0 ? currentHighBid : 'None'}
            </span>
          </div>
        </div>

        {/* Bid history */}
        {bids.length > 0 && (
          <div className={isCompact ? 'mb-2' : 'mb-4'}>
            <h3 className={`font-semibold text-gray-700 ${isCompact ? 'text-xs mb-1' : 'mb-2'}`}>Bids So Far:</h3>
            <div className="space-y-0.5">
              {bids.map((bid, index) => (
                <div key={index} className={`flex justify-between bg-gray-50 rounded ${isCompact ? 'text-xs px-2 py-0.5' : 'text-sm px-3 py-1'}`}>
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
          <div className={isCompact ? 'space-y-2' : 'space-y-4'}>
            {/* Show dealer hint when "Take It" is available */}
            {validBids.includes(-1) && (
              <div className={`bg-yellow-50 border border-yellow-200 rounded text-yellow-800 ${isCompact ? 'p-1 text-xs' : 'p-2 text-sm'}`}>
                As dealer, you can "Take It" to claim the current bid without raising!
              </div>
            )}
            <div>
              <label className={`block font-semibold text-gray-700 ${isCompact ? 'text-xs mb-1' : 'text-sm mb-2'}`}>
                Your Bid:
              </label>
              <select
                value={selectedBid}
                onChange={(e) => setSelectedBid(Number(e.target.value))}
                className={`w-full border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                  isCompact ? 'p-2 text-sm' : 'p-3 text-lg'
                }`}
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
              className={`w-full bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition-colors ${
                isCompact ? 'py-2 px-3 text-sm' : 'py-3 px-6'
              }`}
            >
              {selectedBid === 0 ? 'Pass' : selectedBid === -1 ? 'Take It' : `Bid ${selectedBid}`}
            </button>
            {previewBid != null && (
              <div className={`text-center text-blue-400 animate-pulse ${isCompact ? 'text-xs mt-1' : 'text-sm mt-2'}`}>
                Auto Play would: {getBidLabel(previewBid)}
              </div>
            )}
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
