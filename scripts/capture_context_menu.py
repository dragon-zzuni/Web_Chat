"""Capture screenshot of chat UI with custom context menu"""
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
        page.fill('#name', 'ContextMenuTest')
        page.fill('#pw', PASSWORD)

        # Join room
        page.click('button:has-text("입장")')
        page.wait_for_timeout(3000)

        # Send a test message
        page.fill('#msg', 'Right-click me to see the context menu! 🖱️')
        page.click('#send')
        page.wait_for_timeout(1500)

        # Scroll to bottom
        log_element = page.locator('#log')
        log_element.evaluate('el => el.scrollTop = el.scrollHeight')

        page.wait_for_timeout(1000)

        # Find the last message and right-click it
        messages = page.locator('.chatline')
        if messages.count() > 0:
            last_msg = messages.last
            # Get bounding box to right-click in the middle
            box = last_msg.bounding_box()
            if box:
                # Right-click on the message
                page.mouse.click(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2, button='right')
                page.wait_for_timeout(500)

        # Capture screenshot with context menu visible
        page.screenshot(path='tmp/chat_context_menu.png', full_page=False)
        print("✅ Screenshot saved to tmp/chat_context_menu.png")

        page.wait_for_timeout(2000)
        browser.close()

if __name__ == "__main__":
    capture_chat()
