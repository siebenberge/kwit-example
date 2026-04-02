import Kwit from "@kwit/sdk";
import { config } from "./config";

export function getKwit(): Kwit | null {
	if (!config.kwitApiKey) return null;
	return new Kwit(config.kwitApiKey);
}
