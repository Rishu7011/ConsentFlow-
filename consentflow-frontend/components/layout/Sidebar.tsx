import React from "react";
import Link from "next/link";
import { SidebarHealth } from "../dashboard/SidebarHealth";
import { cn } from "@/lib/utils";
import { usePathname } from "next/navigation";



export default function Sidebar() {
    const pathname = usePathname();
    return (
        <aside className="sidebar">
            <div className="logo">
                <div className="logo-mark">CF</div>
                <span className="logo-text">ConsentFlow</span>
            </div>

            <nav className="nav">
                <div className="nav-section">Main</div>
                <Link href="/dashboard" className={cn("nav-item", pathname === "/dashboard" ? "active" : "")}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
                    Dashboard
                </Link>
                <Link href="/users" className={cn("nav-item", pathname === "/users" ? "active" : "")}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" /></svg>
                    Users
                </Link>
                <Link href="/consent" className={cn("nav-item", pathname === "/consent" ? "active" : "")}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3l7 4v5c0 4.5-3 8.7-7 10C8 20.7 5 16.5 5 12V7l7-4z" /><path d="M9 12l2 2 4-4" /></svg>
                    Consent
                </Link>
                <Link href="/audit" className={cn("nav-item", pathname === "/audit" ? "active" : "")}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /><path d="M9 12h6M9 16h4" /></svg>
                    Audit Trail
                </Link>
                <div className="nav-section" style={{ marginTop: '.75rem' }}>Tools</div>
                <Link href="/webhook" className={cn("nav-item", pathname === "/webhook" ? "active" : "")}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 01-3.46 0" /></svg>
                    Webhook
                </Link>
                <Link href="/infer" className={cn("nav-item", pathname === "/infer" ? "active" : "")}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
                    Inference Tester
                </Link>
            </nav>

            <SidebarHealth />
        </aside>
    )
}