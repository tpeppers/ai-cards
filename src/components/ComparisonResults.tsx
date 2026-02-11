import React from 'react';
import { StrategyComparisonResult } from '../simulation/types.ts';
import { BidWhistSimulator } from '../simulation/BidWhistSimulator.ts';

interface ComparisonResultsProps {
  result: StrategyComparisonResult;
}

const ComparisonResults: React.FC<ComparisonResultsProps> = ({ result }) => {
  const { config, summary, interestingGames } = result;

  const strategyNames = config.strategies.map(s => s.name);

  return (
    <div style={{ marginTop: '24px' }}>
      <h2 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '16px' }}>Results</h2>

      {/* Summary table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '24px' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #374151' }}>
            <th style={{ padding: '8px 12px', textAlign: 'left' }}>Strategy (Team 0)</th>
            <th style={{ padding: '8px 12px', textAlign: 'right' }}>Games Won</th>
            <th style={{ padding: '8px 12px', textAlign: 'right' }}>Win Rate</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ borderBottom: '1px solid #4b5563' }}>
            <td style={{ padding: '8px 12px' }}>{strategyNames[0] || 'Strategy A'}</td>
            <td style={{ padding: '8px 12px', textAlign: 'right' }}>{summary.winsPerConfig[0]}</td>
            <td style={{ padding: '8px 12px', textAlign: 'right' }}>
              {(summary.winRate[0] * 100).toFixed(1)}%
            </td>
          </tr>
          <tr style={{ borderBottom: '1px solid #4b5563' }}>
            <td style={{ padding: '8px 12px' }}>{strategyNames[1] || 'Strategy B'}</td>
            <td style={{ padding: '8px 12px', textAlign: 'right' }}>{summary.winsPerConfig[1]}</td>
            <td style={{ padding: '8px 12px', textAlign: 'right' }}>
              {(summary.winRate[1] * 100).toFixed(1)}%
            </td>
          </tr>
        </tbody>
      </table>

      {/* Breakdown */}
      <div style={{
        backgroundColor: '#162b1e',
        padding: '16px',
        borderRadius: '8px',
        marginBottom: '24px'
      }}>
        <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '8px' }}>
          Strategy vs Card Advantage Breakdown
        </h3>
        <p style={{ margin: '4px 0' }}>
          Total simulations: {summary.totalGames}
        </p>
        <p style={{ margin: '4px 0' }}>
          Strategy mattered (winner changed on swap): {summary.strategyMattersCount}{' '}
          ({summary.totalGames > 0 ? ((summary.strategyMattersCount / (summary.totalGames / 2)) * 100).toFixed(1) : 0}% of deck/rotation pairs)
        </p>
        <p style={{ margin: '4px 0' }}>
          Card advantage dominated (same winner both ways): {summary.cardAdvantageDominatedCount}
        </p>
      </div>

      {/* Interesting games */}
      {interestingGames.length > 0 && (
        <div>
          <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '8px' }}>
            Interesting Games (Strategy Mattered)
          </h3>
          <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #374151', position: 'sticky', top: 0, backgroundColor: '#0f1f15' }}>
                  <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: '13px' }}>#</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: '13px' }}>Rotation</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: '13px' }}>Config A Winner</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: '13px' }}>Config A Score</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: '13px' }}>Config B Winner</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: '13px' }}>Config B Score</th>
                  <th style={{ padding: '6px 8px', textAlign: 'center', fontSize: '13px' }}>Play</th>
                </tr>
              </thead>
              <tbody>
                {interestingGames.map((game, idx) => {
                  const rotatedUrl = BidWhistSimulator.rotateDeck(game.deckUrl, game.rotation);
                  const playUrl = `/bidwhist#${rotatedUrl}`;
                  return (
                    <tr key={idx} style={{ borderBottom: '1px solid #374151' }}>
                      <td style={{ padding: '6px 8px', fontSize: '13px' }}>{idx + 1}</td>
                      <td style={{ padding: '6px 8px', fontSize: '13px' }}>{game.rotation}</td>
                      <td style={{ padding: '6px 8px', fontSize: '13px' }}>
                        Team {game.configAResult.winningTeam}
                      </td>
                      <td style={{ padding: '6px 8px', fontSize: '13px' }}>
                        {game.configAResult.teamScores[0]}-{game.configAResult.teamScores[1]}
                      </td>
                      <td style={{ padding: '6px 8px', fontSize: '13px' }}>
                        Team {game.configBResult.winningTeam}
                      </td>
                      <td style={{ padding: '6px 8px', fontSize: '13px' }}>
                        {game.configBResult.teamScores[0]}-{game.configBResult.teamScores[1]}
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'center', fontSize: '13px' }}>
                        <a
                          href={playUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: '#60a5fa', textDecoration: 'underline' }}
                        >
                          Play
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default ComparisonResults;
