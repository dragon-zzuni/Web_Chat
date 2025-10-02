"""Capture screenshot of chat UI"""
from playwright.sync_api import sync_playwright
import os

ROOM = "비밀"
PASSWORD = "qlalf"
HOST = "125.7.235.198:8000"

def capture_chat():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        page = browser.new_page(viewport={'width': 1400, 'height': 900})

        # Navigate to login
        page.goto(f"http://{HOST}/")
        page.wait_for_load_state('networkidle')

        # Fill login form
        page.fill('#room', ROOM)
        page.fill('#name', 'ScreenshotBot')
        page.fill('#pw', PASSWORD)

        # Join room
        page.click('button:has-text("입장")')
        page.wait_for_timeout(2000)  # Wait for messages to load

        # Scroll to see messages
        log_element = page.locator('#log')
        log_element.evaluate('el => el.scrollTop = el.scrollHeight')

        page.wait_for_timeout(1000)

        # Capture screenshot
        os.makedirs('tmp', exist_ok=True)
        page.screenshot(path='tmp/chat_ui_before.png', full_page=False)
        print("✅ Screenshot saved to tmp/chat_ui_before.png")

        browser.close()

if __name__ == "__main__":
    capture_chat()
