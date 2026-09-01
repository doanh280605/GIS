"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { RotatingImagery } from "@/components/rotating-imagery";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const signup = mode === "signup";
  const reduceMotion = useReducedMotion();

  function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    window.setTimeout(() => router.push("/dashboard"), 650);
  }

  return (
    <div className="auth-page">
      <div className="auth-visual">
        <Link href="/" className="landing-brand auth-brand"><span className="terra-mark"><i /><i /><i /></span><span>TerraWatch</span></Link>
        <div className="auth-map"><RotatingImagery variant="auth" /><div className="auth-orbit one" /><div className="auth-orbit two" /><div className="auth-detection"><span>CHANGE 02</span></div></div>
        <motion.blockquote initial={reduceMotion ? false : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .28, duration: .55 }}>“We stopped searching through imagery and started reviewing actual evidence.”</motion.blockquote>
        <p>Geospatial monitoring for teams responsible for real places.</p>
      </div>
      <main className="auth-panel">
        <Link href="/" className="auth-back">← Back to home</Link>
        <motion.form onSubmit={submit} initial={reduceMotion ? false : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .5, ease: [0.22, 1, 0.36, 1] }}>
          <p className="eyebrow-dark">{signup ? "Create a workspace" : "Welcome back"}</p>
          <h1>{signup ? "Start monitoring." : "Log in to TerraWatch."}</h1>
          <p className="auth-subtitle">{signup ? "Set up your team and add your first monitored location." : "Continue to your monitored locations and evidence reports."}</p>
          {signup && <label>Full name<input required autoComplete="name" placeholder="Your name" /></label>}
          <label>Work email<input required type="email" autoComplete="email" placeholder="you@organization.gov" /></label>
          <label>
            <span>Password {!signup && <Link href="/login">Forgot password?</Link>}</span>
            <input required type="password" minLength={8} autoComplete={signup ? "new-password" : "current-password"} placeholder="At least 8 characters" />
          </label>
          {!signup && <label className="remember"><input type="checkbox" /> <span>Remember me on this device</span></label>}
          {signup && <label className="remember"><input required type="checkbox" /> <span>I agree to the Terms and Privacy Policy</span></label>}
          <button className="auth-submit" disabled={loading}>{loading ? "Opening workspace…" : signup ? "Create workspace" : "Log in"}</button>
          <p className="auth-switch">{signup ? "Already have an account?" : "New to TerraWatch?"} <Link href={signup ? "/login" : "/signup"}>{signup ? "Log in" : "Create an account"}</Link></p>
        </motion.form>
      </main>
    </div>
  );
}
