import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import GameEngine from './components/GameEngine.tsx';
import BiddingOverlay from './components/BiddingOverlay.tsx';
import TrumpSelectionOverlay from './components/TrumpSelectionOverlay.tsx';
import DiscardOverlay from './components/DiscardOverlay.tsx';
import LastBook from './components/LastBook.tsx';
import BottomDock from './components/BottomDock.tsx';
import StrategyConfigModal from './components/StrategyConfigModal.tsx';
import { BidWhistGame } from './games/BidWhistGame.ts';
import { GameState } from './types/CardGame.ts';
import { STRATEGY_REGISTRY, BIDWHIST_CURRENT_BEST } from './strategies/index.ts';
import { getGameStateFromUrl } from './urlGameState.js';
import { useDraggable } from './hooks/useDraggable.ts';
import { useResponsiveLayout, PlayAreaLayoutProvider } from './hooks/useResponsiveLayout.ts';
import { playWhistingFanfare, stopWhistingFanfare } from './utils/whistingSound.ts';
import DeviationAlert, { notifyDeviation } from './components/DeviationAlert.tsx';
import JournalSettingsPanel from './components/JournalSettingsPanel.tsx';
import {
  recordBidDecision, recordTrumpDecision, recordDiscardDecision,
  recordPlayDecision, finalizeHand,
  RecordContext,
} from './utils/deviationJournal.ts';
import { ChallengeRecorder, StoredChallengeRecord } from './utils/challengeRecorder.ts';
import { decodeHandRecord } from './utils/gameRecord.ts';
import { BidWhistSimulator } from './simulation/BidWhistSimulator.ts';
import { parseStrategy } from './strategy/parser.ts';
import { StrategyAST } from './strategy/types.ts';

// Champion AST for the Challenge Mode shadow sim — parsed lazily once
// (mirrors deviationJournal's familyAst pattern).
let _championAst: StrategyAST | null = null;
function championAst(): StrategyAST {
  if (!_championAst) _championAst = parseStrategy(BIDWHIST_CURRENT_BEST.text);
  return _championAst;
}

const SUIT_SYMBOLS: { [key: string]: string } = {
  spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣'
};

const SUIT_COLORS: { [key: string]: string } = {
  spades: 'black', hearts: 'red', diamonds: 'red', clubs: 'black'
};

const RANK_DISPLAY: { [key: number]: string } = {
  1: 'A', 11: 'J', 12: 'Q', 13: 'K'
};

const WHISTING_ANIMATIONS = [
  '/animations/win_cascade.webp',
  '/animations/win_explosion.webp',
  '/animations/win_tornado.webp',
  '/animations/win_holy_cascade.webp',
  '/animations/win_holy_explosion.webp',
  '/animations/win_holy_tornado.webp',
  '/animations/win_ice_cascade.webp',
  '/animations/win_ice_explosion.webp',
  '/animations/win_ice_tornado.webp',
  '/animations/win_nature_cascade.webp',
  '/animations/win_nature_explosion.webp',
  '/animations/win_nature_tornado.webp',
  '/animations/win_science_cascade.webp',
  '/animations/win_science_explosion.webp',
  '/animations/win_science_tornado.webp',
  '/animations/win_egyptian_cascade.webp',
  '/animations/win_egyptian_explosion.webp',
  '/animations/win_egyptian_tornado.webp',
  '/animations/win_steampunk_cascade.webp',
  '/animations/win_steampunk_explosion.webp',
  '/animations/win_steampunk_tornado.webp',
  '/animations/win_underwater_cascade.webp',
  '/animations/win_underwater_explosion.webp',
  '/animations/win_underwater_tornado.webp',
];

const BidWhistGameComponent: React.FunctionComponent = () => {
  // Challenge Mode: /bidwhist?challenge=1 — every seat (including the
  // human's Auto Play) uses BIDWHIST_CURRENT_BEST, and each completed
  // hand is recorded as a BWR1 record next to its shadow counterfactual.
  const location = useLocation();
  const challengeMode = new URLSearchParams(location.search).get('challenge') === '1';

  const gameRef = useRef<BidWhistGame>(new BidWhistGame());
  const [gameState, setGameState] = useState<GameState>(gameRef.current.getGameState());
  const [biddingState, setBiddingState] = useState(gameRef.current.getBiddingState());
  const [refreshKey, setRefreshKey] = useState(0);
  const [autoPlaySignal, setAutoPlaySignal] = useState(0);
  const [previewCardId, setPreviewCardId] = useState<string | null>(null);
  const [previewBid, setPreviewBid] = useState<number | null>(null);
  const [previewTrump, setPreviewTrump] = useState<{ suit: string; direction: string } | null>(null);
  const [showAllCards, setShowAllCards] = useState(false);
  // Set by BiddingOverlay once it has exhausted its compact layouts and has to
  // sit on the fan; the human's cards then carry their index along the bottom
  // edge, in the strip the panel leaves exposed.
  const [bidPanelCoversHand, setBidPanelCoversHand] = useState(false);
  const [whistingAnimation, setWhistingAnimation] = useState<string | null>(null);
  // Once-per-game latch for the whisting celebration (see handleGameStateChange).
  const whistingCelebratedRef = useRef(false);

  // Strategy configuration state
  const familyStrategyText = STRATEGY_REGISTRY.find(s => s.game === 'bidwhist' && s.name === 'Family')?.text || null;
  // Challenge Mode puts the champion on the table (overrides stay all-null
  // so every seat, including the human's Auto Play, uses it).
  const [tableStrategy, setTableStrategy] = useState<string | null>(
    challengeMode ? BIDWHIST_CURRENT_BEST.text : familyStrategyText
  );
  const [playerStrategyOverrides, setPlayerStrategyOverrides] = useState<(string | null)[]>([null, null, null, null]);
  const [showStrategyModal, setShowStrategyModal] = useState(false);
  const [showJournalPanel, setShowJournalPanel] = useState(false);

  // Challenge Mode recorder + records panel
  const challengeRecorderRef = useRef(challengeMode ? new ChallengeRecorder(BIDWHIST_CURRENT_BEST.name) : null);
  const [challengeRecords, setChallengeRecords] = useState<StoredChallengeRecord[]>(
    () => (challengeMode ? ChallengeRecorder.load() : [])
  );
  const [showChallengePanel, setShowChallengePanel] = useState(false);

  const game = gameRef.current;
  const rootRef = useRef<HTMLDivElement>(null);
  // Top-level only needs isCompact for chrome sizing; it falls back to the
  // window viewport (fine — isCompact is width-based and the root fills it).
  const { isCompact } = useResponsiveLayout();

  // Draggable overlays
  const lastBookDrag = useDraggable();
  const booksDrag = useDraggable();

  const gameRules = `Bid Whist Rules:

• 4 players in 2 teams (You & North vs East & West)
• 52 cards (standard deck, no jokers)
• Each player gets 12 cards, 4 go to the kitty

Bidding:
• Bid 1-6 (books over 6 you'll win)
• Pass or bid higher than current bid
• Highest bidder wins the kitty

After Winning Bid:
• Take 4 kitty cards (now have 16)
• Choose trump suit and direction
• Discard 4 cards (back to 12)
• Lead the first card

Gameplay:
• Must follow suit if possible
• Trump beats other suits
• Bid winner leads first trick

Scoring:
• Make contract: bid points + 1 per 2 overtricks
• Fail contract: opponents get bid + 1 per 2 undertricks
• All 13 books = Whisting!
• First team to 21 wins (11 = shutout if opponent has 0)

Card Rankings:
• Uptown: A K Q J 10 9 8 7 6 5 4 3 2
• Downtown: A 2 3 4 5 6 7 8 9 10 J Q K`;

  const updateStates = () => {
    setGameState(game.getGameState());
    setBiddingState(game.getBiddingState());
  };

  // Get the effective strategy text for a given player
  const getEffectiveStrategy = useCallback((playerId: number): string | null => {
    const override = playerStrategyOverrides[playerId];
    if (override === null) return tableStrategy; // "Use table strategy"
    if (override === '') return null;             // "Default AI"
    return override;                              // specific strategy text
  }, [tableStrategy, playerStrategyOverrides]);

  // Load the effective strategy for a player onto the game engine
  const loadStrategyForPlayer = useCallback((playerId: number) => {
    const strategy = getEffectiveStrategy(playerId);
    if (strategy) {
      game.loadStrategy(strategy);
    } else {
      game.setStrategy(null);
    }
  }, [getEffectiveStrategy, game]);

  // Journal helper: the handId is the current deckUrl, and the
  // selected-strategy info comes from whatever Auto Play would use
  // for player 0. Uses `getEffectiveStrategy(0)` directly (not
  // `player0EffectiveStrategy` which is declared later in render).
  const recordCtx = useCallback((): RecordContext => {
    const effective = getEffectiveStrategy(0);
    const name = effective === null
      ? 'Default AI'
      : (STRATEGY_REGISTRY.find(s => s.text === effective)?.name || 'Custom');
    return {
      handId: game.getLastDealtDeckUrl() || getGameStateFromUrl() || '',
      selectedStrategyText: effective,
      selectedStrategyName: name,
    };
  }, [game, getEffectiveStrategy]);

  // Fire a deviation banner if the human's choice differs from the
  // selected strategy. Pass the full DecisionRecord so the dialog +
  // console log have full hand/trick context, not just the one-liner.
  const maybeNotifyDeviation = (rec: any) => {
    if (rec.divergedFromSelected) {
      notifyDeviation({
        phase: rec.phase,
        selectedName: rec.selectedName,
        human: rec.humanChoice,
        selectedChoice: rec.selectedChoice,
        handId: rec.handId,
        bidCount: rec.bidCount,
        currentBid: rec.currentBid,
        trumpSuit: rec.trumpSuit,
        direction: rec.direction,
        trickNumber: rec.trickNumber,
        leadSuit: rec.leadSuit,
        currentTrickSoFar: rec.currentTrickSoFar,
        familyChoice: rec.familyChoice,
        claudeFamChoice: rec.claudeFamChoice,
        divergedFromFamily: rec.divergedFromFamily,
        divergedFromClaudeFam: rec.divergedFromClaudeFam,
      });
    }
  };

  // Handle human bid
  const handleBid = (amount: number) => {
    // Record BEFORE placing (so the context reflects the pre-bid state
    // the strategy would have seen).
    const rec = recordBidDecision(game as any, amount, recordCtx());
    maybeNotifyDeviation(rec);
    if (game.placeBid(0, amount)) {
      updateStates();
    }
  };

  // Handle human trump selection
  const handleTrumpSelection = (suit: string, direction: 'uptown' | 'downtown' | 'downtown-noaces') => {
    const rec = recordTrumpDecision(game as any, suit, direction, recordCtx());
    maybeNotifyDeviation(rec);
    if (game.setTrumpSuit(suit, direction)) {
      updateStates();
    }
  };

  // Handle human discard selection
  const handleDiscard = (cardIds: string[]) => {
    const rec = recordDiscardDecision(game as any, cardIds, recordCtx());
    maybeNotifyDeviation(rec);
    if (game.discardCards(cardIds)) {
      updateStates();
      // Signal GameEngine to refresh its state for play phase
      setRefreshKey(prev => prev + 1);
    }
  };

  // Track number of bids to trigger re-renders
  const bidCount = biddingState.bids.length;

  // Auto-process AI bids during bidding phase
  useEffect(() => {
    // Only run during bidding
    if (gameState.gameStage !== 'bidding') return;

    // Get current player from game (source of truth)
    const currentPlayer = game.getGameState().currentPlayer;

    // Only process if it's an AI's turn (not player 0)
    if (currentPlayer === null || currentPlayer === 0) return;

    const timer = setTimeout(() => {
      // Verify still in bidding and same player's turn
      const state = game.getGameState();
      if (state.gameStage !== 'bidding') return;
      if (state.currentPlayer !== currentPlayer) return;

      // Load strategy for this specific AI player
      loadStrategyForPlayer(currentPlayer);
      // Process the AI bid
      game.processAIBid(currentPlayer);

      // Force state update
      const newGameState = game.getGameState();
      const newBiddingState = game.getBiddingState();
      setGameState(newGameState);
      setBiddingState(newBiddingState);
    }, 1000);

    return () => clearTimeout(timer);
  }, [gameState.gameStage, bidCount]);

  // Auto-process AI trump selection
  useEffect(() => {
    if (gameState.gameStage !== 'trumpSelection') return;

    const declarer = game.getDeclarer();
    if (declarer === null || declarer === 0) return;

    // AI player chooses trump
    const timer = setTimeout(() => {
      loadStrategyForPlayer(declarer);
      game.processAITrumpSelection(declarer);
      updateStates();
      // Signal GameEngine to refresh for play phase (AI auto-discards)
      setRefreshKey(prev => prev + 1);
    }, 1500);

    return () => clearTimeout(timer);
  }, [gameState.gameStage]);

  // Determine whether Auto Play should be visible
  const currentDeclarer = game.getDeclarer();
  const showAutoPlay =
    (gameState.gameStage === 'bidding' && gameState.currentPlayer === 0) ||
    (gameState.gameStage === 'trumpSelection' && currentDeclarer === 0) ||
    (gameState.gameStage === 'discarding') ||
    (gameState.gameStage === 'play' && gameState.currentPlayer === 0);

  // Phase-aware Auto Play handler
  const handleAutoPlay = useCallback(() => {
    loadStrategyForPlayer(0);

    const stage = game.getGameState().gameStage;
    const recorder = challengeRecorderRef.current;

    if (stage === 'bidding') {
      if (recorder) recorder.assist({ type: 'bidAssist', bidIndex: game.getBiddingState().bids.length });
      const bid = game.getAIBid(0);
      handleBid(bid);
    } else if (stage === 'trumpSelection') {
      if (recorder) recorder.assist({ type: 'trumpAssist' });
      const result = game.getAITrumpSelection(0);
      handleTrumpSelection(result.suit, result.direction);
    } else if (stage === 'discarding') {
      if (recorder) recorder.assist({ type: 'discardAssist' });
      game.simulateAutoDiscard(0);
      updateStates();
      setRefreshKey(prev => prev + 1);
    } else if (stage === 'play') {
      // Record BEFORE bumping the signal so playIndex reflects the
      // pre-play state the autoplay decision was made in.
      if (recorder) recorder.assist({ type: 'autoplay', playIndex: recorder.playsSoFar(game) });
      // Signal GameEngine to run its internal handleAutoPlay
      setAutoPlaySignal(prev => prev + 1);
    }
  }, [loadStrategyForPlayer, game]);

  // Preview: compute what Auto Play would do on hover
  const handleAutoPlayHover = useCallback(() => {
    loadStrategyForPlayer(0);

    // Consulting the hint counts as assistance. The recorder collapses
    // repeated previews at the same playIndex, so hover-jitter doesn't
    // inflate the record.
    const recorder = challengeRecorderRef.current;
    if (recorder) recorder.assist({ type: 'preview', playIndex: recorder.playsSoFar(game) });

    const stage = game.getGameState().gameStage;

    if (stage === 'bidding') {
      const bid = game.getAIBid(0);
      setPreviewBid(bid);
    } else if (stage === 'trumpSelection') {
      const result = game.getAITrumpSelection(0);
      setPreviewTrump({ suit: result.suit, direction: result.direction });
    } else if (stage === 'play') {
      const bestMove = game.getBestMove(0);
      if (bestMove) {
        setPreviewCardId(bestMove.id);
      }
    }
  }, [loadStrategyForPlayer, game]);

  const handleAutoPlayLeave = useCallback(() => {
    setPreviewCardId(null);
    setPreviewBid(null);
    setPreviewTrump(null);
  }, []);

  // Deal handler (replaces GameEngine's built-in Deal button)
  const handleDeal = useCallback(() => {
    const urlDeal = getGameStateFromUrl();
    if (urlDeal) {
      // URL-seeded deals anchor the dealer at player index 0 so the same
      // URL always replays the same bidding order — and so Game Mode's
      // reconstructed real-life decks (dealer→0, bid1→3, bid2→2, bid3→1)
      // replay the actual table's bid sequence faithfully.
      game.setDealer(0);
    }
    game.dealCards(urlDeal);
    updateStates();
    setRefreshKey(prev => prev + 1);
  }, [game]);

  // Called by GameEngine before each AI card play
  const handleBeforeAIMove = useCallback((playerId: number) => {
    loadStrategyForPlayer(playerId);
  }, [loadStrategyForPlayer]);

  // Track current game stage in a ref so the callback doesn't depend on gameState
  const gameStageRef = useRef(gameState.gameStage);
  gameStageRef.current = gameState.gameStage;

  // Handle game state changes from GameEngine
  const handleGameStateChange = useCallback((newState: GameState) => {
    // Define phase order - never allow regression to earlier phases
    const phaseOrder = ['deal', 'bidding', 'trumpSelection', 'discarding', 'play', 'scoring'];
    const currentStage = gameStageRef.current;
    const currentPhaseIndex = phaseOrder.indexOf(currentStage);
    const newPhaseIndex = phaseOrder.indexOf(newState.gameStage);

    // Allow transition from scoring to deal/bidding (new hand)
    const isNewHand = currentStage === 'scoring' &&
      (newState.gameStage === 'deal' || newState.gameStage === 'bidding');

    // Don't allow GameEngine to regress to earlier phases (stale state)
    // Exception: new hand transitions are allowed
    if (newPhaseIndex < currentPhaseIndex && !isNewHand) {
      return;
    }

    // Don't let GameEngine overwrite state while in managed phases
    if ((newState.gameStage === 'bidding' && currentStage === 'bidding') ||
        (newState.gameStage === 'trumpSelection' && currentStage === 'trumpSelection') ||
        (newState.gameStage === 'discarding' && currentStage === 'discarding')) {
      return;
    }

    // Journal: when a hand just completed (scoring phase reached),
    // record the outcome so the brief tool can line decisions up with
    // the contract result.
    if (newState.gameStage === 'scoring' && currentStage !== 'scoring') {
      const declarer = game.getDeclarer();
      if (declarer !== null) {
        const declTeam = declarer % 2;
        const books = game.getBooksWon();
        const declarerTeamBooks = books[declTeam] + 1; // +1 for kitty
        const bidAmount = game.getCurrentHighBid();
        const contract = bidAmount + 6;
        finalizeHand({
          t: Date.now(),
          handId: game.getLastDealtDeckUrl() || '',
          declarer,
          bidAmount,
          trumpSuit: game.getTrumpSuit() || '',
          direction: game.getBidDirection(),
          booksWon: [books[0], books[1]],
          contract,
          declarerTeamBooks,
          made: declarerTeamBooks >= contract,
        });
      }

      // Challenge Mode: shadow-sim the same deal/dealer with the champion
      // on all four seats and store the BWR1 record. The sim constructs
      // its own BidWhistGame internally, so the live `game` ref is never
      // touched.
      const challengeRecorder = challengeRecorderRef.current;
      if (challengeRecorder) {
        let shadow: { booksWon: [number, number] } | null = null;
        try {
          const detail = BidWhistSimulator.simulateDetailedHand(
            game.getLastDealtDeckUrl(),
            [championAst(), championAst(), championAst(), championAst()],
            game.getDealer(),
          );
          if (detail) shadow = { booksWon: detail.booksWon };
        } catch {}
        challengeRecorder.finalizeHand(game as any, shadow);
        setChallengeRecords(ChallengeRecorder.load());
      }
    }

    // Update both states together to keep them in sync
    const newBiddingState = game.getBiddingState();

    // Detect whisting game-over: show ONE random animation, ONCE per game.
    // The latch is a ref (not the whistingAnimation state) because the
    // overlay clears itself after 5s while game-over state changes keep
    // arriving — guarding on the state re-fired a new random animation
    // every cycle, looping through the whole collection.
    if (!newState.gameOver) {
      whistingCelebratedRef.current = false; // new game re-arms the celebration
    }
    const animSetting = localStorage.getItem('whistingAnimation') || 'enabled';
    if (newState.gameOver && game.getWhistingWinner() >= 0 && !whistingCelebratedRef.current && animSetting !== 'disabled') {
      whistingCelebratedRef.current = true;
      const anim = WHISTING_ANIMATIONS[Math.floor(Math.random() * WHISTING_ANIMATIONS.length)];
      setWhistingAnimation(anim);
      const soundEnabled = (localStorage.getItem('whistingSound') || 'enabled') !== 'disabled';
      if (soundEnabled) playWhistingFanfare();
      // Hold animation, then dismiss to show game-over dialog
      setTimeout(() => {
        setWhistingAnimation(null);
        if (soundEnabled) stopWhistingFanfare();
      }, 5000);
    }

    setGameState(newState);
    setBiddingState(newBiddingState);
  }, [game]);

  // Strategy name helper
  const strategyNameFromText = (text: string | null): string => {
    if (text === null) return 'Default AI';
    return STRATEGY_REGISTRY.find(s => s.text === text)?.name || 'Custom';
  };

  const tableStrategyName = strategyNameFromText(tableStrategy);

  // Check if any player has an override
  const hasAnyOverride = playerStrategyOverrides.some(o => o !== null);

  // Compute display game name
  const displayGameName = (!hasAnyOverride && tableStrategy !== null)
    ? `Bid Whist (${tableStrategyName.toLowerCase()})`
    : 'Bid Whist';

  // Compute player display names
  const basePlayerNames = gameState.players.map(p => p.name);
  const playerDisplayNames = basePlayerNames.map((name, i) => {
    if (!hasAnyOverride) return name; // all use table strategy, no suffixes
    const override = playerStrategyOverrides[i];
    if (override === null) return name; // using table strategy (the default), no suffix
    const overrideName = override === '' ? 'default ai' : strategyNameFromText(override).toLowerCase();
    return `${name} (${overrideName})`;
  });

  // Effective strategy name for player 0 (shown under Auto Play)
  const player0EffectiveStrategy = getEffectiveStrategy(0);
  const player0StrategyName = strategyNameFromText(player0EffectiveStrategy);

  const declarer = game.getDeclarer();
  const isHumanDeclarer = declarer === 0;
  const lastBook = game.getLastCompletedTrick();

  return (
    <div ref={rootRef} className="relative w-full h-full">
      <DeviationAlert />
      {/* Settings trigger — small gear icon in the bottom-left corner so it
          doesn't collide with the top menu bar or the cards at the bottom
          (PlayerArea keeps the compact fan clear of this corner strip).
          Absolute-positioned on the game root, so it's present in both the
          main app and the standalone. */}
      <button
        onClick={() => setShowJournalPanel(true)}
        title="Settings — hand organization, strategy journal"
        style={{
          position: 'absolute', bottom: 8, left: 8, zIndex: 50,
          background: 'rgba(17,24,39,0.7)',
          color: '#9ca3af',
          border: '1px solid #374151',
          borderRadius: '50%',
          width: 32, height: 32,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer',
          fontSize: 14,
        }}
      >
        ⚙
      </button>
      {showJournalPanel && (
        <JournalSettingsPanel
          onClose={() => setShowJournalPanel(false)}
          onHandSortChange={() => {
            // Re-sort in place so flipping the preference mid-hand is visible
            // immediately rather than at the next deal.
            game.resortHands();
            setRefreshKey(prev => prev + 1);
          }}
        />
      )}
      {/* Challenge Mode banner strip — sits just below the menu bar */}
      {challengeMode && (
        <div
          style={{
            position: 'absolute', top: 36, left: '50%', transform: 'translateX(-50%)',
            zIndex: 40, background: '#162b1e', border: '1px solid #2f5d3f',
            borderRadius: 6, padding: '4px 14px', color: '#d1fae5',
            fontSize: 13, whiteSpace: 'nowrap', pointerEvents: 'none',
          }}
        >
          🏆 Challenge Mode — everyone plays {BIDWHIST_CURRENT_BEST.name}. Beat the machine's own line on a deal to flag it.
        </div>
      )}
      {/* Challenge records toggle — bottom-left, stacked above the journal gear
          so both stay inside the narrow corner strip the card fan leaves free */}
      {challengeMode && (
        <button
          onClick={() => setShowChallengePanel(prev => !prev)}
          title="Challenge records"
          style={{
            position: 'absolute', bottom: 48, left: 8, zIndex: 50,
            background: 'rgba(17,24,39,0.7)',
            color: '#fbbf24',
            border: '1px solid #374151',
            borderRadius: '50%',
            width: 32, height: 32,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
            fontSize: 14,
          }}
        >
          🏆
        </button>
      )}
      {/* Challenge records panel */}
      {challengeMode && showChallengePanel && (
        <div
          style={{
            position: 'absolute', bottom: 88, left: 8, zIndex: 55,
            width: 400, maxWidth: 'calc(100% - 16px)', maxHeight: '60%', overflowY: 'auto',
            background: '#162b1e', border: '1px solid #2f5d3f', borderRadius: 8,
            padding: 12, color: '#e5e7eb', fontSize: 12,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontWeight: 'bold' }}>Challenge Records ({challengeRecords.length})</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => {
                  const csv = ChallengeRecorder.toCsv(challengeRecords);
                  const blob = new Blob([csv], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'challenge-records.csv';
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                style={{ background: '#374151', color: '#e5e7eb', border: '1px solid #4b5563', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 11 }}
              >
                Download CSV
              </button>
              <button
                onClick={() => {
                  if (window.confirm('Clear all challenge records?')) {
                    ChallengeRecorder.clear();
                    setChallengeRecords([]);
                  }
                }}
                style={{ background: '#374151', color: '#fca5a5', border: '1px solid #4b5563', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 11 }}
              >
                Clear
              </button>
              <button
                onClick={() => setShowChallengePanel(false)}
                style={{ background: 'transparent', color: '#9ca3af', border: 'none', cursor: 'pointer', fontSize: 12 }}
              >
                ✕
              </button>
            </div>
          </div>
          {challengeRecords.length === 0 && (
            <div style={{ color: '#9ca3af' }}>No hands recorded yet — finish a hand to record it.</div>
          )}
          {challengeRecords.slice().reverse().map((r, i) => {
            let humanBooks: [number, number] | null = null;
            let shadowBooks: [number, number] | null = null;
            try {
              const decoded = decodeHandRecord(r.encoded);
              humanBooks = decoded.outcome.humanBooks;
              shadowBooks = decoded.outcome.shadowBooks;
            } catch {}
            return (
              <div
                key={`${r.ts}-${i}`}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderTop: '1px solid #234233' }}
              >
                <span style={{ color: '#9ca3af', flexShrink: 0 }}>{new Date(r.ts).toLocaleTimeString()}</span>
                <span style={{ fontFamily: 'monospace' }} title={r.deal}>{r.deal.slice(0, 8)}…</span>
                <span title="Your books vs the champion's shadow line">
                  H {humanBooks ? `${humanBooks[0]}-${humanBooks[1]}` : '?'} vs X {shadowBooks ? `${shadowBooks[0]}-${shadowBooks[1]}` : '—'}
                </span>
                <span title="Assists used this hand" style={{ color: '#9ca3af' }}>✋{r.assistCount}</span>
                {r.flagged && (
                  <span style={{ background: '#059669', color: 'white', borderRadius: 4, padding: '0 6px', fontWeight: 'bold' }}>
                    FLAG
                  </span>
                )}
                <button
                  onClick={() => navigator.clipboard.writeText(r.encoded)}
                  title="Copy the encoded BWR1 record"
                  style={{ marginLeft: 'auto', background: '#374151', color: '#e5e7eb', border: '1px solid #4b5563', borderRadius: 4, padding: '1px 8px', cursor: 'pointer', fontSize: 11, flexShrink: 0 }}
                >
                  Copy
                </button>
              </div>
            );
          })}
        </div>
      )}
      <PlayAreaLayoutProvider elementRef={rootRef}>
      <GameEngine
        game={game}
        gameName={displayGameName}
        gameRules={gameRules}
        useUrlSeeding={true}
        hideMoveHistory={true}
        refreshKey={refreshKey}
        onGameStateChange={handleGameStateChange}
        autoPlaySignal={autoPlaySignal}
        hideAutoPlay={true}
        hideDeal={true}
        previewCardId={previewCardId}
        onBeforeAIMove={handleBeforeAIMove}
        onHumanPlay={(card) => {
          const rec = recordPlayDecision(game as any, card, recordCtx());
          maybeNotifyDeviation(rec);
        }}
        playerDisplayNames={playerDisplayNames}
        showAllCards={showAllCards}
        onToggleShowAllCards={() => {
          const nextValue = !showAllCards;
          const recorder = challengeRecorderRef.current;
          if (recorder) {
            recorder.assist({
              type: nextValue ? 'showAllOn' : 'showAllOff',
              playIndex: recorder.playsSoFar(game),
            });
          }
          setShowAllCards(nextValue);
        }}
        hideGameOver={!!whistingAnimation}
        handIndexAtBottom={bidPanelCoversHand}
        extraControls={
          <>
            {/* Deal + Strategy Config */}
            {gameState.gameStage === 'deal' && (
              <div className="relative">
                <div className="flex flex-row gap-0">
                  <button
                    className="bg-blue-600 text-white px-4 py-2 rounded-l hover:bg-blue-700"
                    onClick={handleDeal}
                    id="dealButton"
                  >
                    Deal
                  </button>
                  <button
                    className="bg-blue-600 text-white px-2 py-2 rounded-r hover:bg-blue-700 border-l border-blue-700"
                    onClick={() => setShowStrategyModal(true)}
                  >
                    ...
                  </button>
                </div>
                <div className="text-gray-300 text-xs mt-1 max-w-[160px] truncate">
                  {tableStrategyName}
                </div>
              </div>
            )}
            {/* Push dealt hand to URL */}
            {gameState.gameStage !== 'deal' && game.getLastDealtDeckUrl() && (
              <button
                className="bg-gray-600 text-white px-3 py-1 text-sm rounded hover:bg-gray-500"
                title="Update browser URL with this deal (for sharing/bookmarking)"
                onClick={() => {
                  const deckUrl = game.getLastDealtDeckUrl();
                  window.history.replaceState(null, '', `#${deckUrl}`);
                }}
              >
                Push to URL
              </button>
            )}
          </>
        }
      />

      {/* Last Book display (replaces Move History for Bid Whist) */}
      {gameState.gameStage === 'play' && (
        <LastBook
          lastBook={lastBook}
          playerNames={playerDisplayNames}
          dragOffset={lastBookDrag.position}
          onDragStart={lastBookDrag.handleMouseDown}
          onTouchDragStart={lastBookDrag.handleTouchStart}
        />
      )}

      {/* Books indicator — bottom-left on phones, parked above the human's fan */}
      {gameState.gameStage === 'play' && (() => {
        const books = game.getBooksWon();
        return (
          <BottomDock compactSide="left" wideClassName="top-8 right-4">
            <div
              className={`bg-white bg-opacity-90 rounded border border-gray-400 shadow-md ${
                isCompact ? 'p-1 text-[10px]' : 'p-2'
              }`}
              style={{ transform: `translate(${booksDrag.position.x}px, ${booksDrag.position.y}px)` }}
            >
              <div
                className={`font-bold border-b border-gray-400 mb-1 pb-1 ${isCompact ? 'text-[10px]' : 'text-sm'}`}
                style={{ cursor: 'grab' }}
                onMouseDown={booksDrag.handleMouseDown}
                onTouchStart={booksDrag.handleTouchStart}
              >
                Books
              </div>
              <div className={`flex justify-between ${isCompact ? 'text-[10px]' : 'text-xs'}`}>
                <span>S/N:</span>
                <span className="ml-3 font-bold">{books[0]}</span>
              </div>
              <div className={`flex justify-between ${isCompact ? 'text-[10px]' : 'text-xs'}`}>
                <span>E/W:</span>
                <span className="ml-3 font-bold">{books[1]}</span>
              </div>
            </div>
          </BottomDock>
        );
      })()}

      {/* Bidding overlay */}
      {biddingState.biddingPhase && (
        <BiddingOverlay
          isYourTurn={gameState.currentPlayer === 0}
          currentHighBid={biddingState.currentHighBid}
          validBids={game.getValidBids()}
          bids={biddingState.bids}
          playerNames={playerDisplayNames}
          dealer={biddingState.dealer}
          currentBidder={gameState.currentPlayer}
          onBid={handleBid}
          previewBid={previewBid}
          onHandCoverageChange={setBidPanelCoversHand}
        />
      )}

      {/* Trump selection overlay */}
      {game.isTrumpSelectionPhase() && (
        <TrumpSelectionOverlay
          isYourTurn={isHumanDeclarer}
          winningBid={biddingState.currentHighBid}
          playerHand={gameState.players[0]?.hand || []}
          onSelectTrump={handleTrumpSelection}
          previewTrump={previewTrump}
        />
      )}

      {/* Kitty display when Show All Cards is enabled during bidding/trump phases */}
      {showAllCards && (biddingState.biddingPhase || game.isTrumpSelectionPhase()) && game.getKitty().length > 0 && (
        <div
          className="absolute z-[51] pointer-events-none"
          style={
            isCompact
              ? { top: '4px', right: '4px' }
              : { top: '50%', left: 'calc(50% + 230px)', transform: 'translateY(-50%)' }
          }
        >
          <div className={`bg-white bg-opacity-95 rounded-lg shadow-lg pointer-events-auto ${isCompact ? 'p-1' : 'p-3'}`}>
            <div className={`font-semibold text-gray-500 text-center ${isCompact ? 'text-[9px] mb-1' : 'text-xs mb-2'}`}>Kitty</div>
            <div className="grid grid-cols-2 gap-1">
              {game.getKitty().map(card => (
                <div
                  key={card.id}
                  className={`bg-white border border-gray-300 rounded flex flex-col items-center justify-center font-bold shadow-sm ${
                    isCompact ? 'w-6 h-8 text-[9px]' : 'w-10 h-14 text-xs'
                  }`}
                  style={{ color: SUIT_COLORS[card.suit] || 'black' }}
                >
                  <span>{RANK_DISPLAY[card.rank] || card.rank}</span>
                  <span className={`leading-none ${isCompact ? 'text-xs' : 'text-base'}`}>{SUIT_SYMBOLS[card.suit]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Discard overlay */}
      {game.isDiscardPhase() && (
        <DiscardOverlay
          playerHand={gameState.players[0]?.hand || []}
          trumpSuit={game.getTrumpSuit()}
          onDiscard={handleDiscard}
        />
      )}

      {/* Auto Play button (z-60 to float above overlays). On phones it takes the
          bottom-center slot above the fan — the bottom-right corner is the Last
          Book panel's, and the two used to sit on top of each other. */}
      {showAutoPlay && (
        <BottomDock compactSide="center" wideClassName="top-10 right-4" zIndexClass="z-[60]" className="text-center">
          <button
            className={`bg-green-600 text-white rounded hover:bg-green-700 ${isCompact ? 'px-2 py-1 text-xs' : 'px-3 py-1 text-sm'}`}
            onClick={handleAutoPlay}
            onMouseEnter={handleAutoPlayHover}
            onMouseLeave={handleAutoPlayLeave}
          >
            Auto Play
          </button>
          <div className={`text-gray-300 mt-0.5 truncate ${isCompact ? 'text-[9px] max-w-[100px]' : 'text-xs max-w-[140px]'}`}>
            {player0StrategyName}
          </div>
        </BottomDock>
      )}

      {/* Strategy Configuration Modal */}
      {showStrategyModal && (
        <StrategyConfigModal
          tableStrategy={tableStrategy}
          playerOverrides={playerStrategyOverrides}
          onApply={(newTable, newOverrides) => {
            setTableStrategy(newTable);
            setPlayerStrategyOverrides(newOverrides);
            setShowStrategyModal(false);
          }}
          onCancel={() => setShowStrategyModal(false)}
        />
      )}

      {/* Whisting animation overlay */}
      {whistingAnimation && (() => {
        const isFullscreen = (localStorage.getItem('whistingAnimation') || 'enabled') === 'fullscreen';
        return (
          <div className="absolute inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[100]">
            <div className="text-center" style={isFullscreen ? { width: '100vw', height: '100vh', position: 'relative' } : undefined}>
              <img
                src={whistingAnimation}
                alt="Whisting celebration"
                style={isFullscreen
                  ? { width: '100vw', height: '100vh', objectFit: 'cover', borderRadius: 0 }
                  : { maxWidth: '80vw', maxHeight: '70vh', borderRadius: '12px' }
                }
              />
              <div style={{
                fontSize: '48px', fontWeight: 'bold', color: '#fbbf24',
                textShadow: '2px 2px 8px rgba(0,0,0,0.8)',
                ...(isFullscreen
                  ? { position: 'absolute', bottom: '40px', left: 0, right: 0 }
                  : { marginTop: '16px' }),
              }}>
                WHISTED!
              </div>
            </div>
          </div>
        );
      })()}
      </PlayAreaLayoutProvider>
    </div>
  );
};

export default BidWhistGameComponent;
