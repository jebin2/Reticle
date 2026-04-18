import { useEffect, useRef, useState } from "react";
import { getRPC } from "./rpc";
import { type Asset, type TrainingRun } from "./types";

const SAVE_DEBOUNCE_MS = 250;

export function useStudioState() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [runs, setRuns] = useState<TrainingRun[]>([]);
  const loadedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveSeqRef = useRef(0);
  const latestQueuedSeqRef = useRef(0);

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

    const payload = { assets, runs };
    const saveSeq = ++saveSeqRef.current;
    latestQueuedSeqRef.current = saveSeq;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    saveTimerRef.current = setTimeout(() => {
      getRPC().request.saveStudio(payload).catch(err => {
        if (latestQueuedSeqRef.current === saveSeq) {
          console.error("Failed to save studio data:", err);
        }
      });
    }, SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [assets, runs]);

  return { assets, setAssets, runs, setRuns };
}
