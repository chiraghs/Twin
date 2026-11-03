"""One-shot CLI: ask the Twin MCP agent (Muse Spark) a question and print its tool calls and answer.

    uv run python ask.py "Which machine is most at risk?"
"""

import asyncio
import sys

from dotenv import load_dotenv

load_dotenv("twin_mcp_agent/.env")

from twin_mcp_agent.agent import ask  # noqa: E402


async def main(question: str) -> int:
    answer = await ask(question, on_tool_call=lambda name, args: print(f"→ {name}({args})"))
    print("\n" + answer)
    return 0 if answer else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main(" ".join(sys.argv[1:]) or "Give me a short status of the plant.")))
