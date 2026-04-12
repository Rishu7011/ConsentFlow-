"use client";

import React, { MouseEvent, useEffect, useRef } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import gsap from 'gsap';
import { AnimatedBeam } from '@/components/magicui/animated-beam';
import { UserX, ShieldCheck, Database, Network, Ban, LineChart, AlertTriangle } from 'lucide-react';
import './css/landing.css';

export default function Home() {
  const flowRef = useRef<HTMLDivElement>(null);
  const div1Ref = useRef<HTMLDivElement>(null);
  const div2Ref = useRef<HTMLDivElement>(null);
  const div3Ref = useRef<HTMLDivElement>(null);
  const div4Ref = useRef<HTMLDivElement>(null);
  const div5Ref = useRef<HTMLDivElement>(null);
  const div6Ref = useRef<HTMLDivElement>(null);

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    const card = e.currentTarget;
    const r = card.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%';
    const y = ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%';
    card.style.setProperty('--mx', x);
    card.style.setProperty('--my', y);
  };

  useEffect(() => {
    let ctx = gsap.context(() => {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const nodes = entry.target.querySelectorAll('.flow-node');
            
            const tl = gsap.timeline();
            tl.fromTo(nodes, 
              { y: 20, opacity: 0 },
              { y: 0, opacity: 1, duration: 0.4, stagger: 0.1, ease: "back.out(1.2)" }
            );
            
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.3 });

      if (flowRef.current) {
        observer.observe(flowRef.current);
      }
      return () => observer.disconnect();
    }, flowRef);

    return () => ctx.revert();
  }, []);

  const staggerContainer = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.15
      }
    }
  };

  const fadeUpVariant = {
    hidden: { opacity: 0, y: 30 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] as const } }
  };

  return (
    <>
      <div className="landing-body">
        <div className="mesh"></div>

        <div className="page">
          {/* NAV */}
          <motion.nav 
            initial={{ opacity: 0, y: -20 }} 
            animate={{ opacity: 1, y: 0 }} 
            transition={{ duration: 0.5, ease: "easeOut" }}
          >
            <Link href="/" className="logo">
              <div className="logo-mark">CF</div>
              <span className="logo-text">ConsentFlow</span>
            </Link>
            <ul className="nav-links">
              <li><Link href="#">Gates</Link></li>
              <li><Link href="/api/docs">API Docs</Link></li>
              <li><Link href="/audit">Audit Trail</Link></li>
            </ul>
            <Link href="/dashboard" className="nav-cta">View Demo →</Link>
          </motion.nav>

          {/* HERO */}
          <motion.div 
            className="hero"
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
          >
            <motion.div className="hero-badge" variants={fadeUpVariant}>
              <span className="badge-dot"></span>
              AI × Privacy 
            </motion.div>
            <motion.h1 variants={fadeUpVariant}>Consent lives<br />at every <em>gate.</em></motion.h1>
            <motion.p className="hero-sub" variants={fadeUpVariant}>
              ConsentFlow enforces user revocations across your entire AI pipeline — datasets, training runs, inference endpoints, and drift windows. In real time.
            </motion.p>
            <motion.div className="hero-actions" variants={fadeUpVariant}>
              <Link href="/dashboard" className="btn-primary">Live Demo</Link>
              <a href="https://github.com/Rishu7011/ConsentFlow-" className="btn-ghost" target="_blank" rel="noopener noreferrer">View on GitHub ↗</a>
            </motion.div>
          </motion.div>

          {/* STATS */}
          <motion.div 
            className="stats"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ duration: 0.7, ease: "easeOut" }}
          >
            <div className="stat">
              <div className="stat-num"><span>4</span></div>
              <div className="stat-label">Enforcement gates</div>
            </div>
            <div className="stat">
              <div className="stat-num"><span>&lt;5ms</span></div>
              <div className="stat-label">Redis cache lookup</div>
            </div>
            <div className="stat">
              <div className="stat-num"><span>Real-time</span></div>
              <div className="stat-label">Kafka propagation</div>
            </div>
            <div className="stat">
              <div className="stat-num"><span>0</span></div>
              <div className="stat-label">Consent gaps</div>
            </div>
          </motion.div>

          {/* FLOW - Animated by GSAP */}
          <motion.div 
            style={{ marginBottom: '1rem' }}
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <div className="section-label">How it works</div>
            <div className="section-title">One revocation.<br />Every stage blocked.</div>
            <div className="section-sub">From OneTrust webhook to inference gate — in milliseconds.</div>
          </motion.div>

          <div className="flow-wrap relative" style={{ marginBottom: '2rem', padding: '3rem 2rem' }} ref={flowRef}>
            <div className="flex flex-col md:flex-row items-center justify-between gap-10 max-w-5xl mx-auto relative z-10 w-full">
              {/* User Revokes */}
              <div className="flex flex-col justify-center">
                <div ref={div1Ref} className="flex items-center justify-center">
                  <div className="flow-node w-[160px] h-[130px] flex flex-col justify-center items-center">
                    <UserX className="w-8 h-8 mb-2 opacity-60" />
                    <div className="flow-node-label">User revokes</div>
                    <div className="flow-node-sub">OneTrust / UI</div>
                  </div>
                </div>
              </div>

              {/* ConsentFlow */}
              <div className="flex flex-col justify-center">
                <div ref={div2Ref} className="flex items-center justify-center">
                  <div className="flow-node accent w-[160px] h-[130px] flex flex-col justify-center items-center border-[#7c6dfa] shadow-[0_0_20px_rgba(124,109,250,0.3)]">
                    <ShieldCheck className="w-8 h-8 mb-2 text-[#7c6dfa]" />
                    <div className="flow-node-label">ConsentFlow</div>
                    <div className="flow-node-sub">DB + Redis + Kafka</div>
                  </div>
                </div>
              </div>

              {/* Four Gates */}
              <div className="flex flex-col justify-center gap-6">
                <div ref={div3Ref} className="flex items-center justify-center">
                  <div className="flow-node w-[160px] h-[130px] flex flex-col justify-center items-center">
                    <Database className="w-8 h-8 mb-2 opacity-60" />
                    <div className="flow-node-label">Dataset gate</div>
                    <div className="flow-node-sub">Presidio PII scrub</div>
                  </div>
                </div>
                <div ref={div4Ref} className="flex items-center justify-center">
                  <div className="flow-node w-[160px] h-[130px] flex flex-col justify-center items-center">
                    <Network className="w-8 h-8 mb-2 opacity-60" />
                    <div className="flow-node-label">Training gate</div>
                    <div className="flow-node-sub">MLflow quarantine</div>
                  </div>
                </div>
                <div ref={div5Ref} className="flex items-center justify-center">
                  <div className="flow-node danger w-[160px] h-[130px] flex flex-col justify-center items-center">
                    <Ban className="w-8 h-8 mb-2 text-[#fa6d8a]" />
                    <div className="flow-node-label">Inference gate</div>
                    <div className="flow-node-sub">403 Forbidden</div>
                  </div>
                </div>
                <div ref={div6Ref} className="flex items-center justify-center">
                  <div className="flow-node w-[160px] h-[130px] flex flex-col justify-center items-center">
                    <div className="relative mb-2 w-8 h-8 flex items-center justify-center opacity-60">
                      <LineChart className="w-7 h-7" />
                      <AlertTriangle className="w-4 h-4 text-[#fa6d8a] absolute -bottom-1 -right-1" />
                    </div>
                    <div className="flow-node-label">Drift Monitor</div>
                    <div className="flow-node-sub">Evidently alerts</div>
                  </div>
                </div>
              </div>
            </div>

            <AnimatedBeam containerRef={flowRef} fromRef={div1Ref} toRef={div2Ref} duration={3} gradientStartColor="#7c6dfa" gradientStopColor="#3ecfb2" label="webhook / API" />
            <AnimatedBeam containerRef={flowRef} fromRef={div2Ref} toRef={div3Ref} curvature={-70} endYOffset={-10} duration={3} gradientStartColor="#3ecfb2" gradientStopColor="#fa6d8a" label="Kafka event" />
            <AnimatedBeam containerRef={flowRef} fromRef={div2Ref} toRef={div4Ref} curvature={-20} duration={3} gradientStartColor="#3ecfb2" gradientStopColor="#fa6d8a" label="Kafka event" />
            <AnimatedBeam containerRef={flowRef} fromRef={div2Ref} toRef={div5Ref} curvature={20} duration={3} gradientStartColor="#3ecfb2" gradientStopColor="#fa6d8a" label="Kafka event" />
            <AnimatedBeam containerRef={flowRef} fromRef={div2Ref} toRef={div6Ref} curvature={70} endYOffset={10} duration={3} gradientStartColor="#3ecfb2" gradientStopColor="#fa6d8a" label="Kafka event" />
          </div>

          {/* GATES */}
          <motion.div 
            style={{ marginBottom: '2rem' }}
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
          >
            <div className="section-label">Architecture</div>
            <div className="section-title">The four gates</div>
            <div className="section-sub">Every stage of your AI pipeline — enforced.</div>
          </motion.div>

          <motion.div 
            className="gates"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={{
              visible: { transition: { staggerChildren: 0.15 } },
              hidden: {}
            }}
          >
            <motion.div className="gate-card" onMouseMove={handleMouseMove} variants={fadeUpVariant}>
              <div className="gate-icon" style={{ background: 'rgba(124,109,250,0.12)' }}>🗃️</div>
              <div className="gate-num">Gate 01</div>
              <div className="gate-title">Dataset gate</div>
              <div className="gate-desc">Per-record consent check before MLflow registration. Revoked users' PII is anonymized via Microsoft Presidio before any data lands in your feature store.</div>
              <span className="gate-tag">Presidio · MLflow artifacts</span>
            </motion.div>
            <motion.div className="gate-card" onMouseMove={handleMouseMove} variants={fadeUpVariant}>
              <div className="gate-icon" style={{ background: 'rgba(62,207,178,0.1)' }}>🧠</div>
              <div className="gate-num">Gate 02</div>
              <div className="gate-title">Training gate</div>
              <div className="gate-desc">Kafka consumer watches <code style={{ fontSize: '11px', opacity: 0.7 }}>consent.revoked</code>. Any mid-flight MLflow training run touching that user gets tagged <code style={{ fontSize: '11px', opacity: 0.7 }}>quarantined</code> immediately.</div>
              <span className="gate-tag">Kafka consumer · MLflow tags</span>
            </motion.div>
            <motion.div className="gate-card" onMouseMove={handleMouseMove} variants={fadeUpVariant}>
              <div className="gate-icon" style={{ background: 'rgba(250,109,138,0.1)' }}>🚫</div>
              <div className="gate-num">Gate 03</div>
              <div className="gate-title">Inference gate</div>
              <div className="gate-desc">ASGI middleware — fail-closed. Missing user → 400. Revoked → 403. Infra failure → 503. Granted users pass through in &lt;5ms via Redis cache hit.</div>
              <span className="gate-tag">ASGI · Redis · LangChain callback</span>
            </motion.div>
            <motion.div className="gate-card" onMouseMove={handleMouseMove} variants={fadeUpVariant}>
              <div className="gate-icon" style={{ background: 'rgba(250,180,50,0.1)' }}>📊</div>
              <div className="gate-num">Gate 04</div>
              <div className="gate-title">Drift monitor</div>
              <div className="gate-desc">Tags every sample in Evidently drift windows with consent status. Emits severity-graded alerts — warning below 5 revoked samples, critical above.</div>
              <span className="gate-tag">Evidently AI · DriftAlert</span>
            </motion.div>
          </motion.div>

          {/* TECH */}
          <motion.div 
            style={{ marginBottom: '1.5rem', textAlign: 'center' }}
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
          >
            <div className="section-label">Built with</div>
          </motion.div>
          
          <motion.div 
            className="tech"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-50px" }}
            variants={{
              visible: { transition: { staggerChildren: 0.05 } },
              hidden: {}
            }}
          >
            {['FastAPI', 'PostgreSQL', 'Redis', 'Apache Kafka', 'MLflow', 'Microsoft Presidio', 'Evidently AI', 'OpenTelemetry', 'Grafana', 'Docker Compose', 'asyncpg', 'aiokafka'].map((tech) => (
              <motion.span 
                key={tech} 
                className="tech-pill"
                variants={{
                  hidden: { opacity: 0, scale: 0.8 },
                  visible: { opacity: 1, scale: 1, transition: { duration: 0.4, ease: "backOut" } }
                }}
              >
                {tech}
              </motion.span>
            ))}
          </motion.div>

          {/* FOOTER */}
          <footer className="footer-section">
            <span>ConsentFlow — MIT License</span>
            <a href="https://github.com/Rishu7011/ConsentFlow-" className="footer-link" target="_blank" rel="noopener noreferrer">github.com/Rishu7011 ↗</a>
          </footer>
        </div>
      </div>
    </>
  );
}
