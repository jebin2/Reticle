import { useEffect, useRef, useState } from "react";
import { getRPC } from "./rpc";
import { type Asset, type TrainingRun } from "./types";

export function useStudioState() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [runs, setRuns] = useState<TrainingRun[]>([]);
  const loadedRef = useRef(false);

  useEffect(() => {
    getRPC().request.loadStudio({}).then(data => {
      setAssets(data.assets);
      setRuns(data.runs);
      loadedRef.current = true;
    }).catch(err => {
      console.error("Failed to load studio data:", err);
      loadedRef.current = true;
    });
  }, []);

  useEffect(() => {
    if (!loadedRef.current) return;
    getRPC().request.saveStudio({ assets, runs }).catch(err => {
      console.error("Failed to save studio data:", err);
    });
  }, [assets, runs]);

  return { assets, setAssets, runs, setRuns };
}
