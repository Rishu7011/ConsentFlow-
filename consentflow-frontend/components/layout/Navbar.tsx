import React from 'react'
import { motion } from 'framer-motion'
import Link from 'next/link'



export default function Navbar() {
    return (
        <>
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
        </>
    )
}