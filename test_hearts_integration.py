import pytest
import subprocess
import time
import signal
import os
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC


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
        
        # Start the npm development server
        self.npm_process = subprocess.Popen(
            ['npm', 'start'],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            preexec_fn=os.setsid,  # Create new process group for easier cleanup
            cwd=os.getcwd()
        )
        
        # Wait 30 seconds for the server to start
        print("Waiting 30 seconds for npm server to start...")
        time.sleep(30)
        
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
            assert "React App" in self.driver.title or "Hearts" in self.driver.title
            
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
            
            # Verify the page is responsive
            assert self.driver.current_url == "http://localhost:3000/" or self.driver.current_url == "http://localhost:3000"
            
            print("Hearts game integration test passed successfully!")
            
        except Exception as e:
            # Capture screenshot for debugging if test fails
            try:
                self.driver.save_screenshot('/tmp/hearts_test_failure.png')
                print("Screenshot saved to /tmp/hearts_test_failure.png")
            except:
                pass
            
            # Get page source for debugging
            try:
                with open('/tmp/hearts_test_page_source.html', 'w') as f:
                    f.write(self.driver.page_source)
                print("Page source saved to /tmp/hearts_test_page_source.html")
            except:
                pass
            
            pytest.fail(f"Hearts game test failed: {e}")


if __name__ == "__main__":
    # Run the test directly
    pytest.main([__file__, "-v"])