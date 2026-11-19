'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useAuth } from '@/providers/AuthProvider';
import { deliverQueuedFeedback, onFeedbackRefused } from '@/utils/feedbackOutbox';
import { useQuietScreen } from '@/utils/quietScreen';
import { subscribeToReachableAgain } from '@/utils/reachableAgain';
import { useTranslation } from '@locales/useTranslation';

/** A busy server or a refusal with a waiting time is asked again this often while the page is open. */
const FEEDBACK_RETRY_MS = 60_000;

/**
 * Delivers the feedback kept on this device (`utils/feedbackOutbox`). Renders nothing. Mounted with the
 * other background workers of every private page, outside anything a screen hides — the preaching
 * screen included — so a feedback written offline leaves as soon as the server is in reach again.
 * A feedback the server refused for good is said once; over a sermon being preached the message waits
 * until preaching ends (`quietScreen`).
 */
export function FeedbackDelivery() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const say = useRef(t);
  say.current = t;
  const ownerId = user?.uid;
  const quiet = useQuietScreen();
  const [refusalWaiting, setRefusalWaiting] = useState(false);

  useEffect(() => onFeedbackRefused(() => { setRefusalWaiting(true); }), []);

  useEffect(() => {
    if (!refusalWaiting || quiet) return;
    setRefusalWaiting(false);
    toast.error(say.current('feedback.deliveryRefused'));
  }, [refusalWaiting, quiet]);

  useEffect(() => {
    if (!ownerId) return;
    const deliver = () => { void deliverQueuedFeedback(ownerId).catch(() => undefined); };
    deliver();
    const stopListening = subscribeToReachableAgain(deliver);
    const timer = window.setInterval(deliver, FEEDBACK_RETRY_MS);
    return () => {
      stopListening();
      window.clearInterval(timer);
    };
  }, [ownerId]);

  return null;
}
