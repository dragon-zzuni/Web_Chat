"""Capture screenshot of improved chat UI"""
from playwright.sync_api import sync_playwright
import time

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
        page.fill('#name', 'UITest')
        page.fill('#pw', PASSWORD)

        # Join room
        page.click('button:has-text("입장")')
        page.wait_for_timeout(3000)  # Wait for messages to load

        # Send a test message
        page.fill('#msg', 'Testing the new clean UI layout! 🎨')
        page.click('#send')
        page.wait_for_timeout(1000)

        # Scroll to see messages
        log_element = page.locator('#log')
        log_element.evaluate('el => el.scrollTop = el.scrollHeight')

        page.wait_for_timeout(1500)

        # Hover over a message to see the action buttons
        messages = page.locator('.chatline')
        if messages.count() > 0:
            # Hover over the last message
            messages.last.hover()
            page.wait_for_timeout(500)

        # Capture screenshot
        page.screenshot(path='tmp/chat_ui_after.png', full_page=False)
        print("✅ Screenshot saved to tmp/chat_ui_after.png")

        # Keep browser open for manual inspection
        page.wait_for_timeout(2000)

        browser.close()

if __name__ == "__main__":
    capture_chat()
