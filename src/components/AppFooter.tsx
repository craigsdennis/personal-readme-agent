export function AppFooter() {
  return (
    <footer className="site-footer">
      <p>
        Built with <span aria-hidden="true">🧡</span> using{" "}
        <a href="https://workers.cloudflare.com/agents" target="_blank" rel="noreferrer">
          Cloudflare Agents
        </a>{" "}
        {"&&"}{" "}
        <a href="https://developers.cloudflare.com/workers-ai" target="_blank" rel="noreferrer">
          Workers AI
        </a>{" "}
        {"&&"}{" "}
        <a href="https://deepgram.com/product/speech-to-text" target="_blank" rel="noreferrer">
          Deepgram Flux
        </a>
      </p>
      <p>
        <a href="https://github.com/craigsdennis/personal-readme-agent" target="_blank" rel="noreferrer">
          👀 the code
        </a>
      </p>
    </footer>
  );
}
