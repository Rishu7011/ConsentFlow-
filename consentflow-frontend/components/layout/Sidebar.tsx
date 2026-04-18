"use client";

import React, { useRef } from "react";
import Link from "next/link";
import { SidebarHealth } from "../dashboard/SidebarHealth";
import { cn } from "@/lib/utils";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import gsap from "gsap";
import "./Sidebar.css";

const navItems = [
    { href: "/dashboard", label: "Dashboard", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg> },
    { href: "/users", label: "Users", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" /></svg> },
    { href: "/consent", label: "Consent", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3l7 4v5c0 4.5-3 8.7-7 10C8 20.7 5 16.5 5 12V7l7-4z" /><path d="M9 12l2 2 4-4" /></svg> },
    { href: "/audit", label: "Audit Trail", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /><path d="M9 12h6M9 16h4" /></svg> },
];

const toolsItems = [
    { href: "/webhook", label: "Webhook", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 01-3.46 0" /></svg> },
    { href: "/infer", label: "Inference Tester", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg> },
    { href: "/policy", label: "Policy Auditor", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.35C17.25 22.15 21 17.25 21 12V7l-9-5z" strokeLinejoin="round" /><path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" /></svg> },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MotionLink = motion.create ? motion.create(Link) : (motion as any)(Link);

export default function Sidebar() {
    const pathname = usePathname();
    const logoRef = useRef<HTMLAnchorElement>(null);
    const navRef = useRef<HTMLElement>(null);

    const handleMouseEnter = (e: React.MouseEvent<HTMLAnchorElement>) => {
        // Subtle GSAP animation for icon on hover
        const svg = e.currentTarget.querySelector('svg');
        if (svg) {
            gsap.to(svg, { 
                scale: 1.15,
                y: -1,
                rotate: 2,
                duration: 0.3, 
                ease: "back.out(1.5)" 
            });
        }
    };

    const handleMouseLeave = (e: React.MouseEvent<HTMLAnchorElement>) => {
        const svg = e.currentTarget.querySelector('svg');
        if (svg) {
            gsap.to(svg, { 
                scale: 1,
                y: 0,
                rotate: 0,
                duration: 0.3, 
                ease: "power2.out" 
            });
        }
    };

    return (
        <aside className="sidebar">
            <Link href={"/"} className="logo" ref={logoRef}>
                <div className="logo-mark">CF</div>
                <span className="logo-text">ConsentFlow</span>
            </Link>

            <nav className="nav" ref={navRef}>
                <div className="nav-section">Main</div>
                {navItems.map((item) => {
                    const isActive = pathname === item.href;
                    return (
                        <div key={item.href} className="w-full">
                            <MotionLink 
                                href={item.href} 
                                className={cn("nav-item", isActive ? "active" : "")}
                                onMouseEnter={handleMouseEnter}
                                onMouseLeave={handleMouseLeave}
                                whileHover={{ x: 4, backgroundColor: "rgba(255, 255, 255, 0.05)" }}
                                whileTap={{ scale: 0.98 }}
                                transition={{ duration: 0.2 }}
                            >
                                {item.icon}
                                {item.label}
                            </MotionLink>
                        </div>
                    );
                })}

                <div className="nav-section" style={{ marginTop: '.75rem' }}>Tools</div>
                {toolsItems.map((item) => {
                    const isActive = pathname === item.href;
                    return (
                        <div key={item.href} className="w-full">
                            <MotionLink 
                                href={item.href} 
                                className={cn("nav-item", isActive ? "active" : "")}
                                onMouseEnter={handleMouseEnter}
                                onMouseLeave={handleMouseLeave}
                                whileHover={{ x: 4, backgroundColor: "rgba(255, 255, 255, 0.05)" }}
                                whileTap={{ scale: 0.98 }}
                                transition={{ duration: 0.2 }}
                            >
                                {item.icon}
                                {item.label}
                            </MotionLink>
                        </div>
                    );
                })}
            </nav>

            <div>
                <SidebarHealth />
            </div>
        </aside>
    )
}