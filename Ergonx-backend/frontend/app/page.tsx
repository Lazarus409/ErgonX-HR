import Link from "next/link";

const workspaces = ["executive", "hr", "leave", "attendance", "payroll", "finance", "reports"];
const modules = ["employees", "leave", "attendance", "payroll", "accounting"];
export default function Home() {
  return <main><section className="hero"><p className="eyebrow">ERGONX</p><h1>Institution workspaces</h1><p>Installable, responsive operational screens backed by the ErgonX API.</p><Link href="/login">Sign in</Link></section><nav className="cards">{workspaces.map((item) => <Link key={item} href={`/workspace/${item}`} className="card">{item.replace(/^./, c => c.toUpperCase())}<span>Open workspace →</span></Link>)}</nav><h2>Operational modules</h2><nav className="cards">{modules.map((item) => <Link key={item} href={`/modules/${item}`} className="card">{item.replace(/^./, c => c.toUpperCase())}<span>Browse records →</span></Link>)}</nav></main>;
}
