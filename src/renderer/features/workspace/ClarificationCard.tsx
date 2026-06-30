/**
 * ClarificationCard — the interactive surface for the agent's `AskUserQuestion`
 * tool. Unlike a tool approval, this is a *workflow pause point*: the run is
 * suspended inside `canUseTool` and resumes only once the user's answers are
 * returned. So this is not a fleeting toast or a detached modal — it is an
 * opaque, full-width card docked directly above the Composer, the natural
 * continuation point of the paused conversation. The streamed reasoning stays
 * visible above it; a lightweight "Waiting for your decision…" marker lives in
 * the stream (see ConversationView).
 *
 * The agent authors the questions (1–4, each with 2–4 options); the app only
 * renders them and collects selections (CLAUDE.md / SDK contract). To keep focus,
 * the card is a lightweight wizard — one question at a time with Back / Next /
 * Submit — which does not change the answers returned to Claude.
 */
import { useEffect, useState } from 'react';
import { Check, MessageCircleQuestion } from 'lucide-react';
import type { ClarificationRequest } from '@shared/types';
import { cn } from '@/renderer/lib/cn';
import { useAgentStore } from '@/renderer/stores/useAgentStore';

export function ClarificationCard({ request }: { request: ClarificationRequest }) {
  const respondClarification = useAgentStore((s) => s.respondClarification);
  const questions = request.questions;
  const total = questions.length;

  const [step, setStep] = useState(0);
  // Per-question selected option labels and an optional free-text answer.
  const [selected, setSelected] = useState<string[][]>(() => questions.map(() => []));
  const [texts, setTexts] = useState<string[]>(() => questions.map(() => ''));

  const current = questions[step];
  const last = step === total - 1;
  const answered = selected[step].length > 0 || texts[step].trim().length > 0;

  function toggleOption(label: string): void {
    setSelected((prev) => {
      const nextStep = current.multiSelect
        ? prev[step].includes(label)
          ? prev[step].filter((l) => l !== label)
          : [...prev[step], label]
        : [label];
      return prev.map((s, i) => (i === step ? nextStep : s));
    });
    // For single-select, a chosen option supersedes any free text.
    if (!current.multiSelect) {
      setTexts((prev) => prev.map((t, i) => (i === step ? '' : t)));
    }
  }

  function setText(value: string): void {
    setTexts((prev) => prev.map((t, i) => (i === step ? value : t)));
    // For single-select, typing supersedes any chosen option.
    if (!current.multiSelect && value.trim()) {
      setSelected((prev) => prev.map((s, i) => (i === step ? [] : s)));
    }
  }

  function submit(): void {
    const answers: Record<string, string | string[]> = {};
    questions.forEach((q, i) => {
      const text = texts[i].trim();
      if (q.multiSelect) {
        const arr = [...selected[i], ...(text ? [text] : [])];
        if (arr.length > 0) answers[q.question] = arr;
      } else {
        const value = text || selected[i][0];
        if (value) answers[q.question] = value;
      }
    });
    respondClarification(answers);
  }

  function advance(): void {
    if (!answered) return;
    if (last) submit();
    else setStep((s) => Math.min(s + 1, total - 1));
  }

  // Cmd/Ctrl+Enter advances or submits — mirrors the approval card's affordance.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        advance();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-3">
      <div className="flex flex-col gap-3 rounded-md border border-line bg-elevated p-4 shadow-[0_8px_30px_rgba(0,0,0,0.6)] animate-fade-in">
        {/* Header: icon + question header + progress */}
        <div className="flex items-center gap-2">
          <MessageCircleQuestion size={15} className="shrink-0 text-accent" />
          <span className="text-[12px] font-semibold uppercase tracking-wide text-accent">
            {current.header}
          </span>
          {total > 1 && (
            <span className="ml-auto flex items-center gap-2">
              <span className="text-[11px] text-faint">
                Question {step + 1} of {total}
              </span>
              <span className="flex items-center gap-1">
                {questions.map((_, i) => (
                  <span
                    key={i}
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      i === step ? 'bg-accent' : 'bg-line-strong',
                    )}
                  />
                ))}
              </span>
            </span>
          )}
        </div>

        {/* Question text */}
        <p className="text-[14px] font-medium leading-snug text-fg">{current.question}</p>

        {/* Options */}
        <div className="flex flex-col gap-1.5">
          {current.options.map((opt) => {
            const isSelected = selected[step].includes(opt.label);
            return (
              <button
                key={opt.label}
                type="button"
                onClick={() => toggleOption(opt.label)}
                className={cn(
                  'flex items-start gap-2.5 rounded-md border px-3 py-2 text-left transition-colors',
                  isSelected
                    ? 'border-accent bg-accent/10'
                    : 'border-line bg-surface-2 hover:border-line-strong hover:bg-elevated',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border',
                    current.multiSelect ? 'rounded-[4px]' : 'rounded-full',
                    isSelected ? 'border-accent bg-accent text-base' : 'border-line-strong',
                  )}
                >
                  {isSelected && <Check size={11} strokeWidth={3} />}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-[13px] font-medium text-fg">{opt.label}</span>
                  {opt.description && (
                    <span className="text-[12px] leading-relaxed text-muted">{opt.description}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {/* Free-text alternative */}
        <input
          type="text"
          value={texts[step]}
          onChange={(e) => setText(e.target.value)}
          placeholder={current.multiSelect ? 'Add your own answer…' : 'Or type your own answer…'}
          className="w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-[13px] text-fg placeholder:text-faint focus:border-line-strong focus:outline-none"
        />

        {/* Footer: Back · progress · Next/Submit */}
        <div className="flex items-center gap-3 pt-0.5">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(s - 1, 0))}
            disabled={step === 0}
            className="rounded-md border border-line px-3 py-1.5 text-[12px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
          >
            Back
          </button>
          <span className="ml-auto text-[11px] text-faint">
            {current.multiSelect ? 'Select one or more' : 'Select one'}
          </span>
          <button
            type="button"
            onClick={advance}
            disabled={!answered}
            className="rounded-md bg-accent px-3.5 py-1.5 text-[12px] font-semibold text-base transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {last ? 'Submit' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
