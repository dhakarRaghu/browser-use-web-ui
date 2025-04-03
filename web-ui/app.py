import os
import asyncio
import logging
import base64
import json
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
from langchain_google_genai import ChatGoogleGenerativeAI
from src.agent.custom_agent import CustomAgent, CustomAgentStepInfo
from src.browser.custom_browser import CustomBrowser
from src.agent.custom_prompts import CustomSystemPrompt, CustomAgentMessagePrompt
from src.browser.custom_context import BrowserContextConfig, CustomBrowserContext
from src.controller.custom_controller import CustomController
from browser_use.browser.browser import BrowserConfig
from browser_use.browser.context import BrowserContextWindowSize

load_dotenv()

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

class TaskRequest(BaseModel):
    task: str

websockets = []

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    websockets.append(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "stop":
                logger.info("Stop request received")
                # Add stop logic here if CustomAgent supports it
    except WebSocketDisconnect:
        websockets.remove(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        websockets.remove(websocket)

async def broadcast(data: dict):
    for ws in websockets:
        try:
            await ws.send_json(data)
        except Exception:
            websockets.remove(ws)

async def run_agent(task: str):
    browser = None
    browser_context = None
    try:
        google_api_key = os.getenv("GOOGLE_API_KEY")
        if not google_api_key:
            raise ValueError("GOOGLE_API_KEY not set in environment variables")

        llm = ChatGoogleGenerativeAI(
            model="gemini-1.5-flash",
            google_api_key=google_api_key,
            temperature=0.7
        )
        browser = CustomBrowser(
            config=BrowserConfig(
                headless=False,  # Keep visible for debugging
                disable_security=True
            )
        )
        browser_context = await browser.new_context(
            config=BrowserContextConfig(
                no_viewport=False,
                browser_window_size=BrowserContextWindowSize(width=1280, height=1100)
            )
        )
        controller = CustomController()
        agent = CustomAgent(
            task=task,
            llm=llm,
            browser=browser,
            browser_context=browser_context,
            controller=controller,
            system_prompt_class=CustomSystemPrompt,
            agent_prompt_class=CustomAgentMessagePrompt,
            max_actions_per_step=6  # Match the 6 actions in your log
        )

        step_info = CustomAgentStepInfo(
            task=task, add_infos="", step_number=1, max_steps=10, memory=""
        )

        logger.info(f"Starting task: {task}")
        while step_info.step_number <= 10 and not agent.state.stopped:
            await agent.step(step_info)
            state = await agent.browser_context.get_state()
            screenshot = None
            if state.screenshot:
                if isinstance(state.screenshot, bytes):
                    screenshot = base64.b64encode(state.screenshot).decode('utf-8')
                else:
                    logger.warning(f"Screenshot type is {type(state.screenshot)}, expected bytes")

            # Adjust this based on your CustomAgent implementation
            thought = ""
            actions = []
            if hasattr(agent.state, 'last_output') and agent.state.last_output:
                thought = agent.state.last_output.current_state.thought
            if hasattr(agent.state, 'last_action') and agent.state.last_action:
                actions = [action.model_dump(exclude_unset=True) for action in agent.state.last_action]

            step_data = {
                "step": step_info.step_number,
                "thought": thought,
                "actions": actions,
                "screenshot": screenshot
            }
            logger.info(f"Step {step_info.step_number}: {step_data['thought']}")
            await broadcast(step_data)

            step_info.step_number += 1
            if agent.state.history.is_done():
                break

        result = agent.state.history.history[-1].result[-1].extracted_content if agent.state.history.history else "Task failed"
        await broadcast({"status": "done", "result": result})
        return result
    except Exception as e:
        error_msg = f"Error: {str(e)}"
        logger.error(error_msg)
        await broadcast({"status": "error", "message": error_msg})
        return None
    finally:
        # Only close if task is done or errored out
        if 'browser_context' in locals() and browser_context:
            await browser_context.close()
        if 'browser' in locals() and browser:
            await browser.close()

@app.post("/run-task")
async def run_task(request: TaskRequest):
    asyncio.create_task(run_agent(request.task))
    return {"message": "Task started"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)