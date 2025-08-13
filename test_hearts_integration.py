import pytest
import subprocess
import time
import signal
import os
import string
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC


def getCardSV(htmlCard):
    cardText = htmlCard.text
    ## quick filter to limit it to cards and not other HTML elements representing the hand
    if len(cardText) > 4 and any(suitSymbol in cardText for suitSymbol in ['♥','♦','♣','♠']):
        splitCard = cardText.split('\n')
        return ''.join(splitCard)[:-1] ## :-1 to cut off 2nd (redundant) card number
    else:
        return None
    

## Convert from StringValue ("2♥") to AlphaPanGram ("B")
def cardSVtoAPG(cardSV):
    if not cardSV or len(cardSV) < 2 or len(cardSV) > 3:
        return None
    
    # Extract suit symbol (last character)
    suit_symbol = cardSV[-1]
    # Extract rank (everything except last character)
    rank_str = cardSV[:-1]
    
    # Convert rank string to numeric rank
    if rank_str == 'A':
        rank = 1
    elif rank_str == 'J':
        rank = 11
    elif rank_str == 'Q':
        rank = 12
    elif rank_str == 'K':
        rank = 13
    else:
        try:
            rank = int(rank_str)
        except ValueError:
            return None
    
    # Convert suit symbol to letter based on schema from urlGameState.js
    # Hearts: a-m (ranks 1-13), Spades: n-z (ranks 1-13) 
    # Clubs: A-M (ranks 1-13), Diamonds: N-Z (ranks 1-13)
    if suit_symbol == '♥':  # Hearts
        return chr(ord('a') + rank - 1)
    elif suit_symbol == '♠':  # Spades  
        return chr(ord('n') + rank - 1)
    elif suit_symbol == '♣':  # Clubs
        return chr(ord('A') + rank - 1)
    elif suit_symbol == '♦':  # Diamonds
        return chr(ord('N') + rank - 1)
    else:
        return None

## Convert from AlphaPanGram ("B") to StringValue ("2♥")
def cardAPGtoSV(cardPGA):
    return None

## Convert from StringValue ("2♥") to text ("Two of Hearts")
def cardSVtoText(cardSV):
    return None

## Convert from AlphaPanGram ("B") to text ("Two of Hearts")
def cardAPGtoText(cardSV):
    return None


class TestHeartsGameIntegration:
    """Integration test for Hearts card game application"""
    
    def setup_method(self):
        """Setup method called before each test"""
        self.npm_process = None
        self.driver = None
    
    def teardown_method(self):
        """Cleanup method called after each test"""
        if self.driver:
            self.driver.quit()
        
        if self.npm_process:
            # Terminate the npm process and all its children
            try:
                os.killpg(os.getpgid(self.npm_process.pid), signal.SIGTERM)
            except (ProcessLookupError, OSError):
                pass  # Process already terminated
    
    def test_hearts_game_startup_and_availability(self):
        """Test that Hearts game starts successfully and is accessible via web browser"""
        
        # Start the server
        self.npm_process = subprocess.Popen(
            ['npm', 'start'],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            preexec_fn=os.setsid,  # Create new process group for easier cleanup
            cwd=os.getcwd()
        )

        print("\n\nWaiting for npm server to start...")
        while True:
            line = self.npm_process.stdout.readline()
            if b"You can now view " in line: break

        # Configure Chrome options for headless mode (good for CI environments)
        chrome_options = Options()
        chrome_options.add_argument('--headless')
        chrome_options.add_argument('--no-sandbox')
        chrome_options.add_argument('--disable-dev-shm-usage')
        chrome_options.add_argument('--disable-gpu')
        chrome_options.add_argument('--window-size=1920,1080')
        
        # Initialize Chrome WebDriver
        self.driver = webdriver.Chrome(options=chrome_options)
        
        try:
            # Navigate to the Hearts game
            self.driver.get('http://localhost:3000')
            
            # Wait for the page to load and verify Hearts game elements are present
            wait = WebDriverWait(self.driver, 10)
            
            # Check if the page title contains expected content
            assert "Cards" in self.driver.title
            
            # Look for game-related elements that indicate Hearts game is running
            # This could include game table, cards, or Hearts-specific UI elements
            game_elements = [
                "game-table",
                "player-area", 
                "card",
                "hearts",
                "game-container"
            ]
            
            # Try to find at least one Hearts game element
            game_found = False
            for element_class in game_elements:
                try:
                    # Try to find element by class name, id, or data attribute
                    elements = (
                        self.driver.find_elements(By.CLASS_NAME, element_class) +
                        self.driver.find_elements(By.ID, element_class) +
                        self.driver.find_elements(By.CSS_SELECTOR, f'[data-testid="{element_class}"]')
                    )
                    if elements:
                        game_found = True
                        print(f"Found Hearts game element: {element_class}")
                        break
                except Exception:
                    continue
            
            # If no specific game elements found, check for React app indicators
            if not game_found:
                try:
                    # Look for React root or any div that might contain the game
                    root_element = wait.until(
                        EC.presence_of_element_located((By.ID, "root"))
                    )
                    assert root_element is not None
                    
                    # Check if there's any content in the root element
                    assert len(root_element.text.strip()) > 0 or len(root_element.find_elements(By.XPATH, ".//*")) > 0
                    game_found = True
                    print("Hearts game application loaded successfully in React root")
                    
                except Exception as e:
                    pytest.fail(f"Could not verify Hearts game is running: {e}")
            
            assert game_found, "Hearts game elements not found on the page"
            gameUrl = self.driver.current_url

            # Verify the page added a random 
            assert "#" in gameUrl

            randomDeal = gameUrl.split("#")[1]

            print("Found random URL portion: " + randomDeal)
            

            ## Check that the randomDeal includes every letter at least once in uppercase & at least once in lowercase
            isDoublePangram = all(letter in gameUrl for letter in string.ascii_letters)

            assert isDoublePangram, "Game URLs must be at least double pangrams!"

            print("Clicking 'deal'...")
            self.driver.find_element(By.ID, "dealButton").click()
            time.sleep(2)

            print("Checking that the deal button deals cards...")
            playerHand = self.driver.find_element(By.ID, "playerHand")
            playerCards = playerHand.find_elements(By.ID,"cardFace")
            print("Found " + str(len(playerCards)) + " cards to look at...")
            assert len(playerCards) == 13, "The starting hand for Hearts must consist of 13 cards"

            for eachLetter in 

            for eachCard in playerCards:
                cardString = getCardSV(eachCard)
                if cardString:
                    print("Looking at a card in the player's hand:  " + cardString)


            print("Hearts game integration test passed successfully!")
            
        except Exception as e:
            # Capture screenshot for debugging if test fails
            try:
                self.driver.save_screenshot('/tmp/hearts_test_failure.png')
                print("Screenshot saved to /tmp/hearts_test_failure.png")
            except:
                pass
            
            pytest.fail(f"Hearts game test failed: {e}")


if __name__ == "__main__":
    # Run the test directly
    pytest.main([__file__, "-v"])