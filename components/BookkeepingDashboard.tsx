'use client';

import React from "react";
import ReconciliationTab from "./bookkeeping/ReconciliationTab";

export default function BookkeepingDashboard() {
  return (
    <div className="min-h-screen p-4">
      <div className="max-w-full mx-auto">
        <ReconciliationTab since="2026-01-01" />
      </div>
    </div>
  );
}
