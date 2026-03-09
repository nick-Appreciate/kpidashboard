import { useState, useEffect, useCallback } from "react";
import type { GLAccount } from "../types/bookkeeping";

export function useAfOptions() {
  const [glAccounts, setGlAccounts] = useState<GLAccount[]>([]);
  const [properties, setProperties] = useState<string[]>([]);
  const [vendors, setVendors] = useState<string[]>([]);
  const [unitsByProperty, setUnitsByProperty] = useState<Record<string, string[]>>({});

  const fetchAfOptions = useCallback(async () => {
    try {
      const res = await fetch("/api/billing/af-options");
      if (!res.ok) return;
      const data = await res.json();
      setGlAccounts(data.gl_accounts || []);
      setProperties(data.properties || []);
      setVendors(data.vendors || []);
      setUnitsByProperty(data.units_by_property || {});
    } catch (error) {
      console.error("Error fetching AF options:", error);
    }
  }, []);

  useEffect(() => {
    fetchAfOptions();
  }, [fetchAfOptions]);

  return { glAccounts, properties, vendors, unitsByProperty, refetchAfOptions: fetchAfOptions };
}
