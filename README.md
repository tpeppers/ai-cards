MORE TODO:

Rewrite test_hearts_integration.py for training usage:

PYTEST as a training harness...

TestSuite fixure: Stands up webserver, loads, validates it works..

TestCLASS fixure: (Re-)Loads a given page for a given hand... Fixed hands within a set allow for exact-known winnable(/unwinnable) hands

TestCase fixture: Runs the page for a given hand, playing the hand... 

    - APG_PROMPT_STRAT: an LLM plays using letters, picking cards to play in APG form ("A" to play the ace of clubs)
    - SV_PROMPT_STRAT_A: an LLM plays using ALPHANUMERIC representations of card rank, but unicode-based suits ("A♣")
    - SV_PROMPT_STRAT_B: an LLM plays using unicode-based representations of cards (🃑, U+1F0D1)
    - SV_PROMPT_STRAT_TEXT: an LLM plays using soley textual represenation of cards ("the ace of clubs")

Each page then has a runnable link at the bottom for terminal, in every HTML OUTPUT FROM TESTS:
xdg-open http://localhost:3000/#[test_case_specific value]

(e.g.: http://localhost:3000/#JZQtRWnjCFVavhBLuIsGxNgwHYzlSrADdKTqeEfOoUiXMmcykbpP )


If the test passes, it's an update one direction...?... idk, maybe [nofail] tests (there will be kobiyashi-marus in the training set, right?)

Generative fixtures:
1) GAMES_OF_INTEREST: test fixture that passes in strings from notable games (easy/hard to win? I-think-we-can-improve-this examples?)
2) GAMES_OF_CHANCE: test fixture that generates (if unspecified) 5-10 games for exploratory usage.. off-by-default? (flag --randoms=10 / -r=10 to enable?)


## Rules of Hearts
Object of the Game:
To be the player with the lowest score at the end of the game. When one player hits the agreed-upon score or higher, the game ends; and the player with the lowest score wins.

Card Values/scoring:
At the end of each hand, players count the number of hearts they have taken as well as the queen of spades, if applicable. Hearts count as one point each and the queen counts 13 points.
Each heart - 1 point
The Q - 13 points
The aggregate total of all scores for each hand must be a multiple of 26.
The game is usually played to 100 points (some play to 50).
When a player takes all 13 hearts and the queen of spades in one hand, instead of losing 26 points, that player scores zero and each of his opponents score an additional 26 points.

The Deal:
Deal the cards one at a time, face down, clockwise. In a four-player game, each is dealt 13 cards; in a three-player game, the 2 of diamonds should be removed, and each player gets 17 cards; in a five-player game, the 2 of clubs should be removed so that each player will get 10 cards.

The Play:
The player holding the 2 of clubs after the pass makes the opening lead. If the 2 has been removed for the three handed game, then the 3 of clubs is led.

Each player must follow suit if possible. If a player is void of the suit led, a card of any other suit may be discarded. However, if a player has no clubs when the first trick is led, a heart or the queen of spades cannot be discarded. The highest card of the suit led wins a trick and the winner of that trick leads next. There is no trump suit.

The winner of the trick collects it and places it face down. Hearts may not be led until a heart or the queen of spades has been discarded. The queen does not have to be discarded at the first opportunity.

The queen can be led at any time.

## ALTERNATIVE ENCODING:

Here are the SHIFT+CTRL-U+1F0[A-D]X codes:	
Unicode 	|  1    2   3   4   5  6   7  8   9  A   B   C   D
U+1F0Ax	    |  🂡	🂢	🂣	🂤	🂥	🂦	🂧	🂨	🂩	🂪	🂫	🂭	🂮
U+1F0Bx	    |  🂱	🂲	🂳	🂴	🂵	🂶	🂷	🂸	🂹	🂺	🂻	🂽	🂾
U+1F0Cx	    |  🃁	🃂	🃃	🃄	🃅	🃆	🃇	🃈	🃉	🃊	🃋	🃍	🃎
U+1F0Dx	    |  🃑	🃒	🃓	🃔	🃕	🃖	🃗	🃘	🃙	🃚	🃛	🃝	🃞

Note the as-of-yet unused KNIGHTS ("cavalier") available in unicode: 🂬🂼🃌🃜 which might be interesting for testing.

Curious if an ad-hoc token-schema performs better or worse than unicode encoding, i.e., asking a model what card to play, after prompting with an entire set of rules, would cause it to pick well?


# Getting Started with Create React App

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

### Code Splitting

This section has moved here: [https://facebook.github.io/create-react-app/docs/code-splitting](https://facebook.github.io/create-react-app/docs/code-splitting)

### Analyzing the Bundle Size

This section has moved here: [https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size](https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size)

### Making a Progressive Web App

This section has moved here: [https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app](https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app)

### Advanced Configuration

This section has moved here: [https://facebook.github.io/create-react-app/docs/advanced-configuration](https://facebook.github.io/create-react-app/docs/advanced-configuration)

### Deployment

This section has moved here: [https://facebook.github.io/create-react-app/docs/deployment](https://facebook.github.io/create-react-app/docs/deployment)

### `npm run build` fails to minify

This section has moved here: [https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify](https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify)
