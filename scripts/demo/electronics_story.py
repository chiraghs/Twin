"""Aurora Electronics demo story (mirrors the original TwinForge video, now on Meta's Muse models).

Numbers in the narration come from the recorded run: backend RUL ≈9.2 h for A-ROB-03, MCU-7 23 h of
supply vs a 72 h lead time, "continue" 732 late units vs "reroute" 0 late at ~24% of the cost.
"""


def scenes(W, C, REPO, m, R, still, clip):
    e = W / "elec"
    return [
        ("Every day, factories lose hours to stops that nobody saw coming. "
         "At Aurora Electronics in Pune, one assembly robot's bearing starts to wear. "
         "A critical microcontroller is running short, and a critical order is due tomorrow. "
         "The warning signs are there, scattered across different systems.",
         lambda: [still(e / f"{k}.png", 3.6) for k in ["e1_line", "e2_robot", "e3_reels", "e4_truck", "e5_control"]]),
        ("This is Twin: an agentic digital twin, built on Meta's Muse models.",
         lambda: [still(C / "title-e.png", 4.6, zoom=False)]),
        ("It mirrors the whole plant live: every line, machine, material, order, camera and mobile robot, in one place, and in 3D.",
         lambda: [clip(R, 2.6, m["calm"]), clip(R, m["calm"] + 2.6, m["twin-3d"])]),
        ("When Robot A3 starts to vibrate, a critical incident opens, and tomorrow's order is at risk.",
         lambda: [clip(R, m["twin-3d"] + 2.6, m["incident"], speed=1.6)]),
        ("Six AI agents investigate, coordinated by an orchestrator, and the intelligence backend adds its own evidence. "
         "The robot will likely trip in about nine hours. And the MCU-7 microcontroller runs out in twenty-three hours, "
         "against a seventy-two hour lead time. Every finding comes with its evidence.",
         lambda: [clip(R, m["incident"] + 2.4, m["agents-start"] + 0.5),
                  clip(R, m["agents-start"] + 0.5, m["agents-done"], target=4, badge="badge-agents"),
                  clip(R, m["agents-done"], m["agents-read"], speed=1.1)]),
        ("Or simply ask the copilot. Running on Muse Spark, it answers from live twin data, shows every tool it used, "
         "and checks every figure in its answer against the tool results.",
         lambda: [clip(R, m["agents-read"] + 2.4, m["copilot-start"] + 0.5),
                  clip(R, m["copilot-start"] + 0.5, m["copilot-done"], target=2.5, badge="badge-copilot"),
                  clip(R, m["copilot-done"], m["copilot-read"])]),
        ("Before anything changes, the twin simulates the options. Carrying on risks a robot failure and more than seven hundred late units. "
         "Moving work to Line B while the robot is maintained keeps every order on time, at about a quarter of the cost.",
         lambda: [clip(R, m["copilot-read"] + 2.4, m["simulator"], speed=0.85)]),
        ("Supply chain analytics flags the microcontrollers and sizes a purchase order: almost eleven thousand units. "
         "The agents only propose; nothing happens on its own. A person approves both plans: "
         "moving work to Line B with a maintenance window, and the order. The twin carries them out. "
         "The robot is repaired, the incident closes, and every plan can still be rolled back.",
         lambda: [clip(R, m["simulator"] + 2.4, m["supply"], speed=1.4),
                  clip(R, m["supply"] + 2.4, m["approved"], speed=1.9),
                  clip(R, m["approved"], m["executed"]),
                  clip(R, m["executed"] + 2.4, m["after"])]),
        ("Every step is on the record. Analytics adds remaining useful life for every machine, stock runway, "
         "the demand forecast, and AOI quality with human review. Each intelligence feature is switched on per plant by an admin.",
         lambda: [clip(R, m["after"] + 2.4, m["audit"]), clip(R, m["audit"] + 2.4, m["an-maint"]), clip(R, m["an-maint"] + 2.4, m["quality"])]),
        ("Any plant can have its own twin. Draw it, describe it, or start from a template, then shape it in the playground.",
         lambda: [clip(R, m["quality"] + 2.4, m["builder"]), clip(R, m["builder"] + 2.4, m["end"])]),
        ("Twin runs on Meta's Muse models and an open-source stack, with open-weight Muse Spark Open for plant-private AI. "
         "Numbers from the twin. Decisions by people.",
         lambda: [still(REPO / "docs/architecture/twin-architecture.png", 6.5, zoom=False), still(C / "end-e.png", 5.5, zoom=False)]),
    ]
