import { LandingExperience } from "@/components/landing/story";
import { getStory } from "@/server/story";

/**
 * Landing page: an Apple-style scroll story. The isometric twin stays pinned while the
 * scripted crisis unfolds; every figure comes from running the engine on that scenario.
 */
export default function Landing() {
  return <LandingExperience story={getStory()} />;
}
