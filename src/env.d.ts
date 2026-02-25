type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
	interface Locals extends Runtime {}
}

interface Env {
	PersonalReadmeAgent: DurableObjectNamespace;
	AI: Ai;
	OPENAI_API_KEY?: string;
	DEEPGRAM_API_KEY?: string;
}

