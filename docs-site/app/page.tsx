import "./landing.css";
import { LandingParticles } from "./components/LandingParticles";

/**
 * The landing page. One screen, no decoration: the block wordmark types
 * itself in like a terminal boot, one tagline, and the way into the docs.
 * Everything is server-rendered; the only motion is CSS steps().
 */

const GITHUB_URL = "https://github.com/linanwanttodo/TNT";

export const metadata = {
  title: "TNT — 终端里的智能体工作台",
};

export default function LandingPage() {
  return (
    <div className="landing">
      <header className="landing-nav">
        <a className="landing-brand" href="/">
          TNT
        </a>
        <nav className="landing-links">
          <a href="/zh">文档</a>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
      </header>

      <main className="landing-hero">
        <div className="landing-art">
          <LandingParticles />
        </div>
        <p className="landing-tagline">终端里的智能体工作台</p>
        <p className="landing-sub">
          会话、技能、插件市场与可控的工具执行，全部发生在你已经在用的那块黑屏里。
        </p>
        <div className="landing-actions">
          <a className="landing-primary" href="/zh">
            查看文档
          </a>
          <a
            className="landing-ghost"
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
          >
            源码仓库
          </a>
        </div>

        <div className="landing-demo" aria-hidden="true">
          <div className="landing-demo-bar">
            <span>tnt</span>
            <span>~/workspace</span>
          </div>
          <pre className="landing-demo-body">
            <span className="landing-demo-line">
              <b>❯</b> /plugins
            </span>
            <span className="landing-demo-line landing-dim">
              marketplace · 社区 3600+ 插件
            </span>
            <span className="landing-demo-line">
              <b>❯</b> 帮我重构 src/auth 的登录流程
            </span>
            <span className="landing-demo-line landing-dim">
              ⠙ 思考中… ( esc 中断 )
            </span>
            <span className="landing-demo-line">
              <b>❯</b>
              <span className="landing-demo-caret">▊</span>
            </span>
          </pre>
        </div>
      </main>

      <section className="landing-feats">
        <div className="landing-feat">
          <h2>终端优先</h2>
          <p>不离开键盘与黑屏：会话、上下文与工具执行按终端的节奏工作。</p>
        </div>
        <div className="landing-feat">
          <h2>插件市场</h2>
          <p>一条命令接入市场，技能、Agent 与 MCP 服务按需安装、随时卸载。</p>
        </div>
        <div className="landing-feat">
          <h2>会话可控</h2>
          <p>每一步工具调用都可展开审阅，esc 随手中断，进度与消耗始终可见。</p>
        </div>
      </section>

      <footer className="landing-foot">
        <span>TNT · 终端里的智能体工作台</span>
        <a href="/zh">阅读文档 →</a>
      </footer>
    </div>
  );
}
