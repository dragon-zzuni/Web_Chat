"""Test script for new chat features: replies, typing, reactions, mentions"""
import asyncio
import websockets
import json

ROOM = "비밀"
PASSWORD = "qlalf"
HOST = "125.7.235.198:8000"

async def test_features():
    uri = f"ws://{HOST}/ws"

    print("🧪 Testing new chat features...")
    print("=" * 50)

    async with websockets.connect(uri) as ws:
        # Join room
        join_msg = {
            "type": "join",
            "room": ROOM,
            "username": "TestBot",
            "password": PASSWORD,
            "color": "#ff0000"
        }
        await ws.send(json.dumps(join_msg))
        print("✅ Joined room")

        # Receive past logs
        msg_id = None
        while True:
            try:
                response = await asyncio.wait_for(ws.recv(), timeout=2.0)
                data = json.loads(response)
                print(f"📨 Received: {data.get('type')}")

                # Capture a message ID for testing replies/reactions
                if data.get('type') == 'chat' and data.get('id'):
                    msg_id = data['id']
                    print(f"   💾 Captured msg_id: {msg_id}")

            except asyncio.TimeoutError:
                print("⏱️  No more past logs")
                break

        # Test 1: Send a regular message
        print("\n1️⃣ Testing regular message...")
        await ws.send(json.dumps({
            "type": "chat",
            "message": "Hello! Testing new features! 🎉",
            "color": "#ff0000"
        }))
        response = await ws.recv()
        data = json.loads(response)
        if data.get('type') == 'chat':
            new_msg_id = data.get('id')
            print(f"   ✅ Message sent, ID: {new_msg_id}")

        # Test 2: Send typing indicator
        print("\n2️⃣ Testing typing indicator...")
        await ws.send(json.dumps({"type": "typing"}))
        print("   ✅ Typing indicator sent")

        # Test 3: Send message with @mention
        print("\n3️⃣ Testing @mention...")
        await ws.send(json.dumps({
            "type": "chat",
            "message": "Hey @TestBot, this is a mention test!",
            "color": "#ff0000"
        }))
        response = await ws.recv()
        data = json.loads(response)
        mention_msg_id = None
        if data.get('type') == 'chat':
            mention_msg_id = data.get('id')
            print(f"   ✅ Mention message sent, ID: {mention_msg_id}")

        # Test 4: Reply to a message
        if new_msg_id:
            print(f"\n4️⃣ Testing reply to message {new_msg_id}...")
            await ws.send(json.dumps({
                "type": "chat",
                "message": "This is a reply!",
                "color": "#ff0000",
                "reply_to_id": new_msg_id
            }))
            response = await ws.recv()
            data = json.loads(response)
            if data.get('type') == 'chat' and data.get('reply_to_id'):
                print(f"   ✅ Reply sent, reply_to_id: {data.get('reply_to_id')}")
            else:
                print(f"   ⚠️  Reply response: {data}")
                print(f"   📝 Expected reply_to_id: {new_msg_id}, Got: {data.get('reply_to_id')}")

        # Test 5: Add reactions
        if mention_msg_id or new_msg_id:
            test_msg_id = mention_msg_id if mention_msg_id else new_msg_id
            print(f"\n5️⃣ Testing reactions on message {test_msg_id}...")

            # Add thumbs up
            await ws.send(json.dumps({
                "type": "reaction",
                "msg_id": test_msg_id,
                "emoji": "👍",
                "action": "add"
            }))
            print("   📤 Sent 👍 reaction")

            # Wait for reaction update
            try:
                response = await asyncio.wait_for(ws.recv(), timeout=2.0)
                data = json.loads(response)
                if data.get('type') == 'reaction_update':
                    print(f"   ✅ Reaction update received: {data.get('reactions')}")
                else:
                    print(f"   📨 Other message: {data.get('type')}")
            except asyncio.TimeoutError:
                print("   ⚠️  No reaction update received")

            # Add heart
            await ws.send(json.dumps({
                "type": "reaction",
                "msg_id": test_msg_id,
                "emoji": "❤️",
                "action": "add"
            }))
            print("   📤 Sent ❤️ reaction")

            try:
                response = await asyncio.wait_for(ws.recv(), timeout=2.0)
                data = json.loads(response)
                if data.get('type') == 'reaction_update':
                    print(f"   ✅ Reaction update received: {data.get('reactions')}")
            except asyncio.TimeoutError:
                print("   ⚠️  No reaction update received")

        print("\n" + "=" * 50)
        print("🎉 All tests completed!")
        print("\nPlease verify in the browser:")
        print("1. Messages appear correctly")
        print("2. @mentions are highlighted")
        print("3. Replies show quoted message")
        print("4. Reactions appear on messages")
        print("5. Typing indicator shows when typing")

if __name__ == "__main__":
    asyncio.run(test_features())
