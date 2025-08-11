import React from 'react';
import GameEngine from './components/GameEngine.tsx';
import { HeartsGame } from './games/HeartsGame.ts';


const HeartsGameComponent: React.FunctionComponent = () => {
  const heartsGame = new HeartsGame();
  
  const gameRules = `Hearts Rules:

• Goal: Have the lowest score at the end
• Each heart = 1 point
• Queen of Spades = 13 points
• Must follow suit if possible
• Can't lead hearts until hearts are broken
• Game ends when someone reaches 100 points
• Shooting the moon: If you take all hearts + Queen of Spades, you get 0 points and others get 26

URL Seeding:
• Add #[52-letter-string] to URL to set initial deck
• a-m = Spades 1-13, n-z = Hearts 1-13
• A-M = Clubs 1-13, N-Z = Diamonds 1-13
• Valid URLs are 'double pangrams' using each letter exactly once`;

  return (
    <GameEngine
      game={heartsGame}
      gameName="Hearts"
      gameRules={gameRules}
      useUrlSeeding={true}
    />
  );
};

export default HeartsGameComponent;