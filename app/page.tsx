'use client';

import { type ReactNode, type SyntheticEvent, useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import {
  ArrowRight,
  BarChart3,
  Check,
  ChevronRight,
  CircleHelp,
  EyeOff,
  LockKeyhole,
  LogOut,
  MessageCircle,
  Flag,
  KeyRound,
  Inbox,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  UserRoundCheck,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { QuestionRow } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';
import {
  createRecoveryCode,
  decryptThreads,
  encryptThreads,
  forgetRecoveryCode,
  getLocalThreads,
  getSavedRecoveryCode,
  migrateSessionThreads,
  recoveryVaultHash,
  saveLocalThread,
  saveRecoveryCode,
  type RecoveryThread,
} from '@/lib/recovery-vault';

type Role = 'employee' | 'hr' | 'responder' | 'analytics';
type StaffRole = 'hr' | 'responder' | null;
type Status =
  | 'Under review'
  | 'Needs clarification'
  | 'Assigned'
  | 'Answered'
  | 'Closed';
type AuthState = 'checking' | 'signin' | 'denied' | 'app';
type VoteDirection = 'up' | 'down';
type Thought = {
  id: number;
  body: string;
  age: string;
  status: 'published' | 'hidden';
};
type Question = {
  id: number;
  question: string;
  detail: string;
  status: Status;
  age: string;
  upvotes: number;
  dislikes: number;
  comments: number;
  responder?: string;
  answer?: string;
  privateReply?: string;
  employeeReply?: string;
  employeeReplyAt?: string;
  owned?: boolean;
  myVote?: VoteDirection;
  threadKey?: string;
  persisted?: boolean;
  moderationState?: 'active' | 'hidden' | 'deleted';
};

type Analytics = {
  total: number;
  answered: number;
  pending: number;
  average_answer_hours: number;
  trend: Array<{ period: string; count: number }>;
  most_liked: { id?: number; question?: string; value?: number };
  most_disliked: { id?: number; question?: string; value?: number };
  most_discussed: { id?: number; question?: string; value?: number };
};

const PAGE_SIZE = 20;

type PublicQuestionRow = Omit<QuestionRow, 'private_reply' | 'thread_key'>;

const seed: Question[] = [
  {
    id: 2841,
    question:
      'Can promotion criteria and review timelines be consistent across teams?',
    detail:
      'The process feels dependent on how each manager explains it. A visible framework would make career conversations more equitable.',
    status: 'Assigned',
    age: '18 min ago',
    upvotes: 42,
    dislikes: 3,
    comments: 8,
    responder: 'Maya · People Leadership',
  },
  {
    id: 2836,
    question: 'What was the reasoning behind the latest territory changes?',
    detail:
      'It would help to understand how the structure improves customer coverage and how success will be measured.',
    status: 'Answered',
    age: 'Yesterday',
    upvotes: 31,
    dislikes: 5,
    comments: 6,
    responder: 'Arjun · Revenue Operations',
    answer:
      'We changed territories to reduce account overlap and create clearer ownership. We will review coverage, response time, and pipeline quality after the first 60 days.',
  },
  {
    id: 2829,
    question: 'How can behind-the-scenes work be recognised more consistently?',
    detail:
      'Research, enablement, and operational work happens before a deal closes, but it is rarely visible in recognition programmes.',
    status: 'Under review',
    age: '2 days ago',
    upvotes: 27,
    dislikes: 2,
    comments: 11,
  },
];

const identityPatterns: Array<[RegExp, string]> = [
  [
    /(only person|only one|my manager|my skip)/gi,
    'A unique role or reporting line may identify you.',
  ],
  [
    /(when I joined|last week I|on my first day)/gi,
    'A precise event may be matched to internal records.',
  ],
  [
    /(india|emea|apac|seattle|bangalore) team/gi,
    'A small regional team may narrow down who you are.',
  ],
];

function randomToken(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

function isGoogleUser(user: User) {
  const providers = Array.isArray(user.app_metadata.providers)
    ? user.app_metadata.providers
    : [];

  return (
    user.app_metadata.provider === 'google' || providers.includes('google')
  );
}

async function hashToken(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function questionReference(question: Question) {
  return question.threadKey
    ? `AF-${question.threadKey.slice(-6).toUpperCase()}`
    : `AF-${question.id}`;
}

function relativeAge(value: string) {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function rowToQuestion(row: PublicQuestionRow): Question {
  return {
    id: row.id,
    question: row.question,
    detail: row.detail,
    status: row.status,
    age: relativeAge(row.created_at),
    upvotes: row.upvotes,
    dislikes: row.dislikes,
    comments: row.comments_count,
    responder: row.responder_label ?? undefined,
    answer: row.answer ?? undefined,
    persisted: true,
    moderationState:
      'moderation_state' in row
        ? ((row.moderation_state as Question['moderationState']) ?? 'active')
        : 'active',
  };
}

export default function HomePage() {
  const [auth, setAuth] = useState<AuthState>('checking');
  const [authPending, setAuthPending] = useState(false);
  const [authError, setAuthError] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [role, setRole] = useState<Role>('employee');
  const [staffRole, setStaffRole] = useState<StaffRole>(null);
  const [responderLabel, setResponderLabel] = useState('');
  const [availableResponders, setAvailableResponders] = useState<string[]>([]);
  const [questions, setQuestions] = useState(seed);
  const [selectedId, setSelectedId] = useState(2829);
  const [draft, setDraft] = useState('');
  const [detail, setDetail] = useState('');
  const [thoughtsByQuestion, setThoughtsByQuestion] = useState<
    Record<number, Thought[]>
  >({});
  const [thoughtsLoadingId, setThoughtsLoadingId] = useState<number | null>(
    null,
  );
  const [thoughtSubmittingId, setThoughtSubmittingId] = useState<number | null>(
    null,
  );
  const [votePendingId, setVotePendingId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [answer, setAnswer] = useState('');
  const [privateReply, setPrivateReply] = useState('');
  const [responder, setResponder] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(2836);
  const [toast, setToast] = useState('');
  const [showProof, setShowProof] = useState(true);
  const [backendState, setBackendState] = useState<
    'connecting' | 'live' | 'error'
  >('connecting');
  const [submitting, setSubmitting] = useState(false);
  const [workflowPending, setWorkflowPending] = useState(false);
  const [feedOffset, setFeedOffset] = useState(0);
  const [hasMoreQuestions, setHasMoreQuestions] = useState(false);
  const [feedLoading, setFeedLoading] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryVersion, setRecoveryVersion] = useState(0);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryPending, setRecoveryPending] = useState(false);
  const [hrThreads, setHrThreads] = useState<
    Record<number, { privateReply?: string; employeeReply?: string }>
  >({});
  const [reportCounts, setReportCounts] = useState<Record<number, number>>({});
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [analyticsPeriod, setAnalyticsPeriod] = useState<'week' | 'month'>('week');
  const [anonymityOpen, setAnonymityOpen] = useState(false);
  const [feedCounts, setFeedCounts] = useState({ total: 0, answered: 0 });

  useEffect(() => {
    let active = true;

    const applyUser = async (user: User | null) => {
      if (user && isGoogleUser(user)) {
        setAuth('checking');
        const { data, error } = await supabase.rpc('get_staff_profile');
        if (!active) return;
        if (!error && data?.[0]) {
          setSessionId((current) => current || randomToken('ses'));
          setAuth('app');
          return;
        }
      }

      if (user) {
        setAuth('denied');
        await supabase.auth.signOut({ scope: 'local' });
        return;
      }

      setAuth((current) => (current === 'denied' ? current : 'signin'));
    };

    void supabase.auth.getUser().then(({ data }) => {
      void applyUser(data.user);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      window.setTimeout(() => void applyUser(session?.user ?? null), 0);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (auth !== 'app') return;

    const loadWorkspace = async () => {
      const { data: profileData, error: profileError } =
        await supabase.rpc('get_staff_profile');
      if (profileError) {
        setBackendState('error');
        return;
      }

      const profile = profileData?.[0];
      const nextStaffRole: StaffRole =
        profile?.staff_role === 'hr' || profile?.staff_role === 'responder'
          ? profile.staff_role
          : null;
      const nextResponderLabel = profile?.responder_label ?? '';
      setStaffRole(nextStaffRole);
      setResponderLabel(
        nextStaffRole === 'hr' ? 'People Team · HR' : nextResponderLabel,
      );
      setRole(nextStaffRole ?? 'employee');

      if (nextStaffRole === 'hr') {
        const { data: responderData } = await supabase.rpc(
          'list_unask_responders',
        );
        const labels = (responderData ?? [])
          .map((item) => item.responder_label)
          .filter((label): label is string => Boolean(label));
        setAvailableResponders(labels);
        setResponder(labels[0] ?? '');
      }

      const { data, error } = await supabase
        .from('questions')
        .select(
          'id, question, detail, status, visibility, display_name, upvotes, dislikes, comments_count, responder_label, answer, moderation_state, created_at, updated_at',
        )
        .order('created_at', { ascending: false })
        .range(0, PAGE_SIZE - 1);
      if (error) {
        setBackendState('error');
        return;
      }
      const [totalCountResult, answeredCountResult] = await Promise.all([
        supabase
          .from('questions')
          .select('id', { count: 'exact', head: true })
          .eq('moderation_state', 'active')
          .in('status', ['Assigned', 'Answered']),
        supabase
          .from('questions')
          .select('id', { count: 'exact', head: true })
          .eq('moderation_state', 'active')
          .eq('status', 'Answered'),
      ]);
      setFeedCounts({
        total: totalCountResult.count ?? 0,
        answered: answeredCountResult.count ?? 0,
      });

      const { data: voteData, error: voteError } = await supabase.rpc(
        'list_my_unask_votes',
      );
      if (voteError) {
        setBackendState('error');
        return;
      }
      const myVotes = new Map<number, VoteDirection>(
        (voteData ?? []).map((vote) => [
          vote.question_id,
          vote.direction as VoteDirection,
        ]),
      );
      const liveQuestions = (data ?? []).map((row) => {
        const question = rowToQuestion(row as PublicQuestionRow);
        return { ...question, myVote: myVotes.get(question.id) };
      });
      setFeedOffset(data?.length ?? 0);
      setHasMoreQuestions((data?.length ?? 0) === PAGE_SIZE);
      migrateSessionThreads();
      const savedCode = getSavedRecoveryCode();
      setRecoveryCode(savedCode);
      if (savedCode) {
        try {
          const vaultHash = await recoveryVaultHash(savedCode);
          const { data: vaultData } = await supabase.rpc(
            'get_unask_recovery_vault',
            { p_vault_hash: vaultHash },
          );
          const vault = vaultData?.[0];
          if (vault) {
            const restored = await decryptThreads(savedCode, vault);
            restored.forEach(saveLocalThread);
            setRecoveryVersion(vault.vault_version);
          }
        } catch {
          forgetRecoveryCode();
          setRecoveryCode('');
        }
      }
      const localThreads = getLocalThreads();
      const ownedQuestions = await Promise.all(
        localThreads.map(async ({ id, token }) => {
          const threadHash = await hashToken(token);
          const { data: threadData } = await supabase.rpc(
            'get_unask_question_thread',
            { p_question_id: id, p_thread_hash: threadHash },
          );
          const row = threadData?.[0];
          if (!row) return null;
          return {
            ...rowToQuestion(row as unknown as PublicQuestionRow),
            privateReply: row.private_reply ?? undefined,
            employeeReply: row.employee_reply ?? undefined,
            employeeReplyAt: row.employee_reply_at ?? undefined,
            owned: true,
            myVote: myVotes.get(id),
            threadKey: token,
          } satisfies Question;
        }),
      );
      const recovered = ownedQuestions.filter(Boolean) as Question[];
      const recoveredIds = new Set(recovered.map((question) => question.id));
      setQuestions([
        ...recovered,
        ...liveQuestions.filter((question) => !recoveredIds.has(question.id)),
      ]);
      if (nextStaffRole === 'hr') {
        const [threadResults, reportResult, analyticsResult] = await Promise.all([
          Promise.all(
            liveQuestions.map(async (question) => {
              const { data: threadData } = await supabase.rpc(
                'get_unask_hr_thread',
                { p_question_id: question.id },
              );
              return [question.id, threadData?.[0]] as const;
            }),
          ),
          supabase.rpc('get_unask_report_counts'),
          supabase.rpc('get_unask_analytics', { p_period: 'week' }),
        ]);
        setHrThreads(
          Object.fromEntries(
            threadResults.map(([id, thread]) => [
              id,
              {
                privateReply: thread?.private_reply ?? undefined,
                employeeReply: thread?.employee_reply ?? undefined,
              },
            ]),
          ),
        );
        setReportCounts(
          Object.fromEntries(
            (reportResult.data ?? []).map((item) => [
              item.question_id,
              Number(item.open_reports),
            ]),
          ),
        );
        if (analyticsResult.data) setAnalytics(analyticsResult.data as unknown as Analytics);
      }
      setBackendState('live');
    };

    void loadWorkspace();
  }, [auth]);

  const risks = useMemo(
    () =>
      identityPatterns.flatMap(([pattern, warning]) => {
        pattern.lastIndex = 0;
        return pattern.test(`${draft} ${detail}`) ? [warning] : [];
      }),
    [draft, detail],
  );

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2600);
  };

  const saveVault = async (
    threads: RecoveryThread[],
    suppliedCode = recoveryCode,
  ) => {
    const code = suppliedCode || createRecoveryCode();
    if (!suppliedCode) {
      saveRecoveryCode(code);
      setRecoveryCode(code);
      setRecoveryVersion(0);
    }
    const [vaultHash, encrypted] = await Promise.all([
      recoveryVaultHash(code),
      encryptThreads(code, threads),
    ]);
    const { data, error } = await supabase.rpc('save_unask_recovery_vault', {
      p_vault_hash: vaultHash,
      p_ciphertext: encrypted.ciphertext,
      p_salt: encrypted.salt,
      p_iv: encrypted.iv,
      p_expected_version: suppliedCode ? recoveryVersion : 0,
    });
    if (error) throw error;
    setRecoveryVersion(data?.[0]?.vault_version ?? 1);
    return code;
  };

  const restoreVault = async (code: string) => {
    setRecoveryPending(true);
    try {
      const vaultHash = await recoveryVaultHash(code);
      const { data, error } = await supabase.rpc('get_unask_recovery_vault', {
        p_vault_hash: vaultHash,
      });
      const vault = data?.[0];
      if (error || !vault) throw new Error('Recovery vault not found');
      const threads = await decryptThreads(code, vault);
      threads.forEach(saveLocalThread);
      saveRecoveryCode(code);
      setRecoveryCode(code);
      setRecoveryVersion(vault.vault_version);
      setRecoveryOpen(false);
      notify(`Restored ${threads.length} anonymous question${threads.length === 1 ? '' : 's'}. Refreshing…`);
      window.setTimeout(() => window.location.reload(), 700);
    } catch {
      notify('That recovery code is invalid or no vault was found.');
    } finally {
      setRecoveryPending(false);
    }
  };

  const forgetThisDevice = () => {
    forgetRecoveryCode();
    setRecoveryCode('');
    setRecoveryVersion(0);
    notify('Recovery code removed from this device. Your encrypted vault remains.');
  };

  const loadMoreQuestions = async () => {
    if (feedLoading || !hasMoreQuestions) return;
    setFeedLoading(true);
    const { data, error } = await supabase
      .from('questions')
      .select(
        'id, question, detail, status, visibility, display_name, upvotes, dislikes, comments_count, responder_label, answer, moderation_state, created_at, updated_at',
      )
      .order('created_at', { ascending: false })
      .range(feedOffset, feedOffset + PAGE_SIZE - 1);
    setFeedLoading(false);
    if (error) {
      notify('More questions could not be loaded.');
      return;
    }
    const next = (data ?? []).map((row) => rowToQuestion(row as PublicQuestionRow));
    setFeedOffset((current) => current + next.length);
    setHasMoreQuestions(next.length === PAGE_SIZE);
    setQuestions((current) => {
      const ids = new Set(current.map((question) => question.id));
      return [...current, ...next.filter((question) => !ids.has(question.id))];
    });
  };

  const loadAnalytics = async (period: 'week' | 'month') => {
    setAnalyticsPeriod(period);
    const { data, error } = await supabase.rpc('get_unask_analytics', {
      p_period: period,
    });
    if (error || !data) {
      notify('Analytics could not be loaded.');
      return;
    }
    setAnalytics(data as unknown as Analytics);
  };

  const requestAccess = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError('');
    setAuthPending(true);
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        skipBrowserRedirect: true,
        queryParams: {
          prompt: 'select_account',
        },
      },
    });
    if (error) {
      setAuthPending(false);
      setAuthError(
        error.message.toLowerCase().includes('provider')
          ? 'Google sign-in is not configured yet. Please contact the Unask administrator.'
          : 'Google sign-in could not start. Please try again.',
      );
      return;
    }

    if (!data.url) {
      setAuthPending(false);
      setAuthError('Google sign-in could not start. Please try again.');
      return;
    }

    window.location.assign(data.url);
  };

  const signOut = async () => {
    await supabase.auth.signOut({ scope: 'local' });
    setAuth('signin');
    setSessionId('');
    setRole('employee');
    setStaffRole(null);
    setResponderLabel('');
    setAvailableResponders([]);
    setBackendState('connecting');
  };

  const submitQuestion = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.trim() || submitting) return;
    setSubmitting(true);
    const threadKey = `${randomToken('thr')}_${crypto.randomUUID().replaceAll('-', '')}`;
    const threadHash = await hashToken(threadKey);
    const { data, error } = await supabase.rpc('submit_unask_question', {
      p_question: draft.trim(),
      p_detail: detail.trim(),
      p_visibility: 'anonymous',
      p_display_name: '',
      p_thread_hash: threadHash,
    });
    const saved = data?.[0];

    if (error || !saved) {
      setSubmitting(false);
      setBackendState('error');
      notify('The question could not be saved. Please try again.');
      return;
    }

    const newThread = { id: saved.id, token: threadKey };
    saveLocalThread(newThread);
    try {
      const code = await saveVault(
        [...getLocalThreads().filter((thread) => thread.id !== saved.id), newThread],
      );
      if (!recoveryCode) {
        setRecoveryCode(code);
        setRecoveryOpen(true);
      }
    } catch {
      notify(
        'Question saved, but cloud recovery did not sync. Keep this browser data until you retry.',
      );
    }

    const question: Question = {
      ...rowToQuestion(saved as unknown as PublicQuestionRow),
      owned: true,
      threadKey,
    };
    setQuestions((current) => [question, ...current]);
    setSelectedId(question.id);
    setExpandedId(question.id);
    setDraft('');
    setDetail('');
    setSubmitting(false);
    setBackendState('live');
    notify(
      `Question ${questionReference(question)} entered the private HR queue.`,
    );
  };

  const respondToClarification = async (id: number, reply: string) => {
    const question = questions.find((item) => item.id === id);
    if (!question?.threadKey || !reply.trim()) return false;
    const threadHash = await hashToken(question.threadKey);
    const { error } = await supabase.rpc('respond_to_unask_clarification', {
      p_question_id: id,
      p_thread_hash: threadHash,
      p_reply: reply.trim(),
    });
    if (error) {
      notify('Your clarification could not be sent.');
      return false;
    }
    setQuestions((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              status: 'Under review',
              employeeReply: reply.trim(),
              employeeReplyAt: new Date().toISOString(),
            }
          : item,
      ),
    );
    notify('Your private clarification was sent to HR.');
    return true;
  };

  const submitReport = async (
    targetType: 'question' | 'thought',
    targetId: number,
    reason: string,
  ) => {
    const { error } = await supabase.rpc('submit_unask_report', {
      p_target_type: targetType,
      p_target_id: targetId,
      p_reason: reason.trim(),
    });
    if (error) {
      notify('The report could not be submitted.');
      return false;
    }
    notify('Report sent privately to HR for review.');
    return true;
  };

  const moderateThought = async (
    questionId: number,
    thoughtId: number,
    action: 'hide' | 'publish' | 'delete',
  ) => {
    const { error } = await supabase.rpc('moderate_unask_thought', {
      p_thought_id: thoughtId,
      p_action: action,
    });
    if (error) {
      notify('That moderation change could not be saved.');
      return;
    }
    await loadThoughts(questionId, true);
    notify(action === 'delete' ? 'Thought permanently deleted.' : `Thought ${action === 'hide' ? 'hidden' : 'restored'}.`);
  };

  const vote = async (id: number, direction: VoteDirection) => {
    if (votePendingId === id) return;
    const previous = questions.find((question) => question.id === id);
    if (!previous) return;
    if (previous.status !== 'Assigned' && previous.status !== 'Answered') {
      notify('Voting opens after HR publishes the question.');
      return;
    }
    setVotePendingId(id);
    const nextVote = previous.myVote === direction ? undefined : direction;
    setQuestions((current) =>
      current.map((question) =>
        question.id === id
          ? {
              ...question,
              upvotes:
                question.upvotes +
                (nextVote === 'up' ? 1 : 0) -
                (question.myVote === 'up' ? 1 : 0),
              dislikes:
                question.dislikes +
                (nextVote === 'down' ? 1 : 0) -
                (question.myVote === 'down' ? 1 : 0),
              myVote: nextVote,
            }
          : question,
      ),
    );
    const { data, error } = await supabase.rpc('set_unask_vote', {
      p_question_id: id,
      p_direction: direction,
    });
    const totals = data?.[0];
    if (error || !totals) {
      setVotePendingId(null);
      setQuestions((current) =>
        current.map((question) => (question.id === id ? previous : question)),
      );
      notify('That vote could not be saved. Please try again.');
      return;
    }
    setVotePendingId(null);
    setQuestions((current) =>
      current.map((question) =>
        question.id === id
          ? {
              ...question,
              upvotes: totals.upvotes,
              dislikes: totals.dislikes,
              myVote: (totals.my_vote as VoteDirection | null) ?? undefined,
            }
          : question,
      ),
    );
  };

  const loadThoughts = async (questionId: number, includeHidden = false) => {
    setThoughtsLoadingId(questionId);
    let query = supabase
      .from('question_thoughts')
      .select('id, body, status, created_at')
      .eq('question_id', questionId)
      .order('created_at', { ascending: true });
    if (!includeHidden) query = query.eq('status', 'published');
    const { data, error } = await query;
    setThoughtsLoadingId(null);
    if (error) {
      notify('Thoughts could not be loaded. Please try again.');
      return;
    }
    const thoughts = (data ?? []).map((thought) => ({
      id: thought.id,
      body: thought.body,
      age: relativeAge(thought.created_at),
      status: thought.status,
    }));
    setThoughtsByQuestion((current) => ({
      ...current,
      [questionId]: thoughts,
    }));
  };

  const submitThought = async (questionId: number, body: string) => {
    if (!body.trim() || thoughtSubmittingId === questionId) return false;
    setThoughtSubmittingId(questionId);
    const { error } = await supabase.rpc('submit_unask_thought', {
      p_question_id: questionId,
      p_body: body.trim(),
    });
    setThoughtSubmittingId(null);
    if (error) {
      notify('That thought could not be saved. Please try again.');
      return false;
    }
    await loadThoughts(questionId);
    setQuestions((current) =>
      current.map((question) =>
        question.id === questionId
          ? { ...question, comments: question.comments + 1 }
          : question,
      ),
    );
    notify('Your anonymous thought was added.');
    return true;
  };

  const requestClarification = async (id: number) => {
    if (!privateReply.trim()) return;
    setWorkflowPending(true);
    const reply = privateReply.trim();
    const { error } = await supabase.rpc('moderate_unask_question', {
      p_question_id: id,
      p_action: 'clarify',
      p_private_reply: reply,
      p_responder_label: '',
    });
    setWorkflowPending(false);
    if (error) {
      notify('The private clarification could not be sent.');
      return;
    }
    setQuestions((current) =>
      current.map((question) =>
        question.id === id
          ? {
              ...question,
              status: 'Needs clarification',
              privateReply: reply,
            }
          : question,
      ),
    );
    setPrivateReply('');
    notify('Private clarification sent through the anonymous thread.');
  };

  const closeQuestion = async (id: number) => {
    setWorkflowPending(true);
    const { error } = await supabase.rpc('moderate_unask_question', {
      p_question_id: id,
      p_action: 'close',
      p_private_reply: '',
      p_responder_label: '',
    });
    setWorkflowPending(false);
    if (error) {
      notify('The question could not be closed.');
      return;
    }
    setQuestions((current) =>
      current.map((question) =>
        question.id === id
          ? { ...question, status: 'Closed', responder: undefined }
          : question,
      ),
    );
    notify('Question closed privately.');
  };

  const moderateQuestionVisibility = async (
    id: number,
    action: 'hide' | 'delete' | 'restore',
  ) => {
    setWorkflowPending(true);
    const { error } = await supabase.rpc('moderate_unask_question', {
      p_question_id: id,
      p_action: action,
      p_private_reply: '',
      p_responder_label: '',
    });
    setWorkflowPending(false);
    if (error) {
      notify('The question moderation change could not be saved.');
      return;
    }
    setQuestions((current) =>
      current.map((question) =>
        question.id === id
          ? { ...question, moderationState: action === 'restore' ? 'active' : action === 'hide' ? 'hidden' : 'deleted' }
          : question,
      ),
    );
    notify(action === 'restore' ? 'Question restored.' : action === 'hide' ? 'Question hidden for scrutiny.' : 'Question moved to deleted review.');
  };

  const approveAndAssign = async (id: number) => {
    if (!responder) return;
    setWorkflowPending(true);
    const { error } = await supabase.rpc('moderate_unask_question', {
      p_question_id: id,
      p_action: 'assign',
      p_private_reply: '',
      p_responder_label: responder,
    });
    setWorkflowPending(false);
    if (error) {
      notify('The question could not be assigned.');
      return;
    }
    setQuestions((current) =>
      current.map((question) =>
        question.id === id
          ? { ...question, status: 'Assigned', responder }
          : question,
      ),
    );
    notify(`Approved and assigned to ${responder.split(' · ')[0]}.`);
  };

  const publishAnswer = async (id: number) => {
    if (!answer.trim()) return;
    if (questions.find((question) => question.id === id)?.owned) {
      notify('You cannot answer a question you submitted.');
      return;
    }
    setWorkflowPending(true);
    const publishedAnswer = answer.trim();
    const { error } = await supabase.rpc('publish_unask_answer', {
      p_question_id: id,
      p_answer: publishedAnswer,
    });
    setWorkflowPending(false);
    if (error) {
      notify('The answer could not be published.');
      return;
    }
    setQuestions((current) =>
      current.map((question) =>
        question.id === id
          ? { ...question, status: 'Answered', answer: publishedAnswer }
          : question,
      ),
    );
    setAnswer('');
    notify('Answer published to the employee feed.');
  };

  if (auth !== 'app')
    return (
      <AuthMock
        state={auth}
        pending={authPending}
        error={authError}
        requestAccess={requestAccess}
        reset={() => {
          setAuthError('');
          setAuth('signin');
        }}
      />
    );

  return (
    <main className="unask-app">
      <Header
        role={role}
        setRole={setRole}
        staffRole={staffRole}
        sessionId={sessionId}
        signOut={signOut}
        backendState={backendState}
      />
      {showProof && (
        <ProofStrip close={() => setShowProof(false)} />
      )}
      {role === 'employee' && (
        <EmployeeView
          questions={questions}
          draft={draft}
          detail={detail}
          thoughtsByQuestion={thoughtsByQuestion}
          thoughtsLoadingId={thoughtsLoadingId}
          thoughtSubmittingId={thoughtSubmittingId}
          votePendingId={votePendingId}
          search={search}
          risks={risks}
          expandedId={expandedId}
          setDraft={setDraft}
          setDetail={setDetail}
          setSearch={setSearch}
          setExpandedId={setExpandedId}
          submit={submitQuestion}
          vote={vote}
          loadThoughts={loadThoughts}
          submitThought={submitThought}
          respondToClarification={respondToClarification}
          submitReport={submitReport}
          loadMore={loadMoreQuestions}
          hasMore={hasMoreQuestions}
          feedLoading={feedLoading}
          recoveryCode={recoveryCode}
          recoveryOpen={recoveryOpen}
          recoveryPending={recoveryPending}
          setRecoveryOpen={setRecoveryOpen}
          restoreVault={restoreVault}
          forgetThisDevice={forgetThisDevice}
          anonymityOpen={anonymityOpen}
          setAnonymityOpen={setAnonymityOpen}
          feedCounts={feedCounts}
          submitting={submitting}
        />
      )}
      {role === 'hr' && (
        <HrView
          questions={questions}
          selectedId={selectedId}
          privateReply={privateReply}
          responder={responder}
          responders={availableResponders}
          pending={workflowPending}
          setSelectedId={setSelectedId}
          setPrivateReply={setPrivateReply}
          setResponder={setResponder}
          requestClarification={requestClarification}
          closeQuestion={closeQuestion}
          approveAndAssign={approveAndAssign}
          thoughtsByQuestion={thoughtsByQuestion}
          thoughtsLoadingId={thoughtsLoadingId}
          loadThoughts={(id) => loadThoughts(id, true)}
          moderateThought={moderateThought}
          hrThreads={hrThreads}
          reportCounts={reportCounts}
          moderateQuestionVisibility={moderateQuestionVisibility}
        />
      )}
      {role === 'responder' && (
        <ResponderView
          questions={questions}
          selectedId={selectedId}
          answer={answer}
          responderLabel={responderLabel}
          pending={workflowPending}
          setSelectedId={setSelectedId}
          setAnswer={setAnswer}
          publishAnswer={publishAnswer}
        />
      )}
      {role === 'analytics' && staffRole === 'hr' && (
        <AnalyticsView
          analytics={analytics}
          period={analyticsPeriod}
          setPeriod={(period) => void loadAnalytics(period)}
        />
      )}
      {toast && (
        <div className="toast">
          <Check />
          {toast}
        </div>
      )}
    </main>
  );
}

function Brand() {
  return (
    <div className="brand">
      <span>
        <Sparkles />
      </span>
      <strong>Unask</strong>
    </div>
  );
}

function AuthMock({
  state,
  pending,
  error,
  requestAccess,
  reset,
}: {
  state: Exclude<AuthState, 'app'>;
  pending: boolean;
  error: string;
  requestAccess: (event: SyntheticEvent<HTMLFormElement>) => void;
  reset: () => void;
}) {
  return (
    <main className="auth-screen">
      <section className="auth-promise">
        <Brand />
        <div>
          <p className="eyebrow">A private place for difficult questions</p>
          <h1>Ask without being known.</h1>
          <p>
            Your login proves that you belong here. It does not become part of
            your question.
          </p>
        </div>
        <small>
          Verified Google access · identity is separated from feedback
        </small>
      </section>
      <section className="auth-panel">
        {state === 'checking' && (
          <div className="auth-card">
            <ShieldCheck className="auth-icon" />
            <p className="eyebrow">Checking access</p>
            <h2>Restoring your secure session…</h2>
          </div>
        )}
        {state === 'signin' && (
          <div className="auth-card">
            <ShieldCheck className="auth-icon" />
            <p className="eyebrow">Everstage access</p>
            <h2>Continue with Google</h2>
            <p>
              Use your Everstage Google Workspace account or an approved test
              account. Other Google accounts are refused.
            </p>
            <form className="auth-form" onSubmit={requestAccess}>
              {error && <p className="auth-error">{error}</p>}
              <Button type="submit" disabled={pending}>
                {pending ? 'Opening Google…' : 'Continue with Google'}
                <ArrowRight />
              </Button>
            </form>
            <div className="auth-note">
              <LockKeyhole />
              Google verifies the account. The private access list decides who
              may enter; feedback omits email and employee ID.
            </div>
          </div>
        )}
        {state === 'denied' && (
          <div className="auth-card proof-card">
            <span className="result-icon denied">×</span>
            <p className="eyebrow">Access refused</p>
            <h2>This account is not approved for Unask.</h2>
            <p>
              Use an @everstage.com Google account or an approved testing
              account. No application access or feedback data was granted.
            </p>
            <Button type="button" variant="outline" onClick={reset}>
              Try another account
            </Button>
          </div>
        )}
      </section>
    </main>
  );
}

function Header({
  role,
  setRole,
  staffRole,
  sessionId,
  signOut,
  backendState,
}: {
  role: Role;
  setRole: (role: Role) => void;
  staffRole: StaffRole;
  sessionId: string;
  signOut: () => void;
  backendState: 'connecting' | 'live' | 'error';
}) {
  return (
    <header className="unask-header">
      <Brand />
      <div className="session-state">
        <EyeOff />
        <span>
          Anonymous session {sessionId.slice(-4)} ·{' '}
          {backendState === 'live'
            ? 'Synced'
            : backendState === 'error'
              ? 'Offline'
              : 'Connecting'}
        </span>
        <button type="button" onClick={signOut} aria-label="End test session">
          <LogOut />
        </button>
      </div>
      <div className="prototype-role">
        <span className="workspace-icon">
          {role === 'hr' ? <ShieldCheck /> : role === 'responder' ? <Users /> : role === 'analytics' ? <BarChart3 /> : <Inbox />}
        </span>
        <label htmlFor="workspace-role">Workspace</label>
        <select
          id="workspace-role"
          value={role}
          onChange={(event) => setRole(event.target.value as Role)}
        >
          <option value="employee">Employee</option>
          {staffRole === 'hr' && <option value="hr">HR moderation</option>}
          {(staffRole === 'responder' || staffRole === 'hr') && (
            <option value="responder">Responder</option>
          )}
          {staffRole === 'hr' && <option value="analytics">Analytics</option>}
        </select>
      </div>
    </header>
  );
}

function ProofStrip({ close }: { close: () => void }) {
  return (
    <div className="proof-strip">
      <ShieldCheck />
      <span>
        <strong>Verified Google access.</strong> Everstage accounts and approved
        testers are checked against a private access rule. Supabase Auth keeps
        email and profile for sign-in, but questions and thoughts do not store
        email or employee ID. Voting uses a per-question pseudonymous marker,
        and anonymous question recovery uses a client-encrypted vault protected
        by your recovery code. Google proves access; it is not the recovery key.
      </span>
      <button type="button" onClick={close}>
        Dismiss
      </button>
    </div>
  );
}

type EmployeeProps = {
  questions: Question[];
  draft: string;
  detail: string;
  thoughtsByQuestion: Record<number, Thought[]>;
  thoughtsLoadingId: number | null;
  thoughtSubmittingId: number | null;
  votePendingId: number | null;
  search: string;
  risks: string[];
  expandedId: number | null;
  setDraft: (value: string) => void;
  setDetail: (value: string) => void;
  setSearch: (value: string) => void;
  setExpandedId: (value: number | null) => void;
  submit: (event: SyntheticEvent<HTMLFormElement>) => void;
  vote: (id: number, direction: VoteDirection) => void;
  loadThoughts: (questionId: number) => Promise<void>;
  submitThought: (questionId: number, body: string) => Promise<boolean>;
  respondToClarification: (questionId: number, reply: string) => Promise<boolean>;
  submitReport: (
    targetType: 'question' | 'thought',
    targetId: number,
    reason: string,
  ) => Promise<boolean>;
  loadMore: () => Promise<void>;
  hasMore: boolean;
  feedLoading: boolean;
  recoveryCode: string;
  recoveryOpen: boolean;
  recoveryPending: boolean;
  setRecoveryOpen: (open: boolean) => void;
  restoreVault: (code: string) => Promise<void>;
  forgetThisDevice: () => void;
  anonymityOpen: boolean;
  setAnonymityOpen: (open: boolean) => void;
  feedCounts: { total: number; answered: number };
  submitting: boolean;
};

function EmployeeView(props: EmployeeProps) {
  const visible = props.questions.filter(
    (question) =>
      question.moderationState !== 'hidden' &&
      question.moderationState !== 'deleted' &&
      (question.status === 'Assigned' ||
        question.status === 'Answered' ||
        question.owned) &&
      `${question.question} ${question.detail}`
        .toLowerCase()
        .includes(props.search.toLowerCase()),
  );
  return (
    <div className="employee-page page-shell">
      <section className="ask-section">
        <div className="ask-heading">
          <div>
            <p className="eyebrow">Employee</p>
            <h1>What do you want to ask?</h1>
          </div>
          <div className="ask-tools">
            <Button type="button" variant="outline" className="anonymity-pill" onClick={() => props.setAnonymityOpen(true)}>
              <EyeOff /> How anonymity works
            </Button>
            <Button type="button" variant="outline" onClick={() => props.setRecoveryOpen(true)}>
              <KeyRound /> My questions
            </Button>
            <div className="quiet-promise">
              <EyeOff />
              <span>
                <strong>Your identity is not attached.</strong> HR receives only
                what you write below.
              </span>
            </div>
          </div>
        </div>
        <form className="editor" onSubmit={props.submit}>
          <Textarea
            value={props.draft}
            onChange={(event) => props.setDraft(event.target.value)}
            placeholder="Ask the question you would ask if nobody knew it came from you…"
            aria-label="Your question"
          />
          <Textarea
            className="context-input"
            value={props.detail}
            onChange={(event) => props.setDetail(event.target.value)}
            placeholder="Add context if it helps (optional)"
            aria-label="Optional context"
          />
          {props.risks.length > 0 && (
            <div className="risk-warning">
              <CircleHelp />
              <span>
                <strong>Before you send:</strong> {props.risks.join(' ')}
              </span>
            </div>
          )}
          <footer>
            <span className="anonymous-only-label">
              <EyeOff /> Submitted anonymously
            </span>
            <Button
              type="submit"
              disabled={!props.draft.trim() || props.submitting}
            >
              {props.submitting ? 'Submitting…' : 'Submit'}
              <ArrowRight />
            </Button>
          </footer>
        </form>
        <p className="editor-footnote">
          <LockKeyhole /> Your recovery code unlocks an encrypted copy of your
          anonymous question keys. If you want to identify yourself, include
          your name in the message body.
        </p>
      </section>
      <section className="feed-section">
        <div className="feed-heading">
          <div>
            <p className="eyebrow">Shared questions</p>
            <h2>See what has already been asked.</h2>
          </div>
          <label className="search-box">
            <Search />
            <input
              value={props.search}
              onChange={(event) => props.setSearch(event.target.value)}
              placeholder="Search questions"
            />
          </label>
        </div>
        <div className="feed-stats" aria-label="Question totals">
          <span><strong>{props.feedCounts.total}</strong> Total questions</span>
          <span><strong>{props.feedCounts.answered}</strong> Answered</span>
          <span><strong>{Math.max(0, props.feedCounts.total - props.feedCounts.answered)}</strong> Awaiting answer</span>
        </div>
        <div className="simple-feed">
          {visible.map((question) => (
            <QuestionRow
              key={question.id}
              question={question}
              expanded={props.expandedId === question.id}
              toggle={() =>
                props.setExpandedId(
                  props.expandedId === question.id ? null : question.id,
                )
              }
              vote={props.vote}
              thoughts={props.thoughtsByQuestion[question.id]}
              thoughtsLoading={props.thoughtsLoadingId === question.id}
              thoughtSubmitting={props.thoughtSubmittingId === question.id}
              votePending={props.votePendingId === question.id}
              loadThoughts={() => props.loadThoughts(question.id)}
              submitThought={(body) => props.submitThought(question.id, body)}
              respondToClarification={(reply) =>
                props.respondToClarification(question.id, reply)
              }
              submitReport={props.submitReport}
            />
          ))}
        </div>
        {props.hasMore && (
          <Button
            type="button"
            variant="outline"
            className="load-more"
            disabled={props.feedLoading}
            onClick={() => void props.loadMore()}
          >
            {props.feedLoading ? 'Loading…' : 'Load more questions'}
          </Button>
        )}
      </section>
      <RecoveryDialog
        open={props.recoveryOpen}
        setOpen={props.setRecoveryOpen}
        recoveryCode={props.recoveryCode}
        pending={props.recoveryPending}
        restore={props.restoreVault}
        forget={props.forgetThisDevice}
      />
      <AnonymityDialog open={props.anonymityOpen} setOpen={props.setAnonymityOpen} />
    </div>
  );
}

function AnonymityDialog({ open, setOpen }: { open: boolean; setOpen: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="anonymity-dialog">
        <DialogHeader>
          <DialogTitle>How Unask protects your identity</DialogTitle>
          <DialogDescription>
            Google sign-in checks that you are allowed into Unask. Your account
            is not written onto your question.
          </DialogDescription>
        </DialogHeader>
        <div className="anonymity-flow">
          <div><ShieldCheck /><strong>1. Verify access</strong><span>Google confirms you are from Everstage or an approved tester.</span></div>
          <ArrowRight />
          <div><EyeOff /><strong>2. Separate identity</strong><span>The question is saved without your email, name, or employee ID.</span></div>
          <ArrowRight />
          <div><KeyRound /><strong>3. Keep ownership private</strong><span>Your recovery code—not your login—unlocks your private question thread.</span></div>
        </div>
        <p className="anonymity-caveat">
          Write carefully: details in the message itself can reveal you. During
          this MVP, infrastructure logs may still allow timing or network
          correlation by highly privileged platform administrators.
        </p>
      </DialogContent>
    </Dialog>
  );
}

function RecoveryDialog({
  open,
  setOpen,
  recoveryCode,
  pending,
  restore,
  forget,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  recoveryCode: string;
  pending: boolean;
  restore: (code: string) => Promise<void>;
  forget: () => void;
}) {
  const [input, setInput] = useState('');
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="recovery-dialog">
        <DialogHeader>
          <DialogTitle>Recover your anonymous questions</DialogTitle>
          <DialogDescription>
            This code, not your Google account, proves which anonymous threads
            belong to you. Unask stores only an encrypted vault and cannot read
            it without the code.
          </DialogDescription>
        </DialogHeader>
        {recoveryCode ? (
          <div className="recovery-current">
            <strong>Your recovery code</strong>
            <code>{recoveryCode}</code>
            <p>
              Save it in a password manager. Anyone with this code can open your
              private question history. Losing it means the history cannot be
              recovered on another device.
            </p>
            <div>
              <Button
                type="button"
                onClick={() => void navigator.clipboard.writeText(recoveryCode)}
              >
                Copy code
              </Button>
              <Button type="button" variant="outline" onClick={forget}>
                Forget this device
              </Button>
            </div>
          </div>
        ) : (
          <div className="recovery-restore">
            <label htmlFor="recovery-code">Recovery code</label>
            <input
              id="recovery-code"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Paste your recovery code"
              autoComplete="off"
            />
            <Button
              type="button"
              disabled={!input.trim() || pending}
              onClick={() => void restore(input)}
            >
              {pending ? 'Decrypting…' : 'Restore my questions'}
            </Button>
            <p>
              A new recovery code is created automatically when you submit your
              first question on this device.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function QuestionRow({
  question,
  expanded,
  toggle,
  vote,
  thoughts,
  thoughtsLoading,
  thoughtSubmitting,
  votePending,
  loadThoughts,
  submitThought,
  respondToClarification,
  submitReport,
}: {
  question: Question;
  expanded: boolean;
  toggle: () => void;
  vote: (id: number, direction: VoteDirection) => void;
  thoughts: Thought[] | undefined;
  thoughtsLoading: boolean;
  thoughtSubmitting: boolean;
  votePending: boolean;
  loadThoughts: () => Promise<void>;
  submitThought: (body: string) => Promise<boolean>;
  respondToClarification: (reply: string) => Promise<boolean>;
  submitReport: (
    targetType: 'question' | 'thought',
    targetId: number,
    reason: string,
  ) => Promise<boolean>;
}) {
  const [showThoughts, setShowThoughts] = useState(false);
  const [thoughtDraft, setThoughtDraft] = useState('');
  const [clarificationDraft, setClarificationDraft] = useState('');
  const [reportTarget, setReportTarget] = useState<
    { type: 'question' | 'thought'; id: number } | undefined
  >();
  const [reportReason, setReportReason] = useState('');

  const toggleThoughts = () => {
    const opening = !showThoughts;
    setShowThoughts(opening);
    if (opening && thoughts === undefined) void loadThoughts();
  };

  const addThought = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (await submitThought(thoughtDraft)) setThoughtDraft('');
  };

  const sendClarification = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (await respondToClarification(clarificationDraft)) {
      setClarificationDraft('');
    }
  };

  const sendReport = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      reportTarget &&
      (await submitReport(reportTarget.type, reportTarget.id, reportReason))
    ) {
      setReportTarget(undefined);
      setReportReason('');
    }
  };

  return (
    <>
      <article className="question-row">
        <button type="button" className="question-main" onClick={toggle}>
        <div>
          <span
            className={`status status-${question.status.toLowerCase().replaceAll(' ', '-')}`}
          >
            {question.status}
          </span>
          {question.owned && (
            <span className="your-question">Your question</span>
          )}
        </div>
        <h3>{question.question}</h3>
        <p>Anonymous · {question.age}</p>
        <ChevronRight />
        </button>
      </article>
      <Dialog
        open={expanded}
        onOpenChange={(open) => {
          if (!open && expanded) toggle();
        }}
      >
        <DialogContent className="question-dialog">
          <DialogHeader>
            <div className="question-dialog-meta">
              <span className={`status status-${question.status.toLowerCase().replaceAll(' ', '-')}`}>
                {question.status}
              </span>
              <span>Anonymous · {question.age}</span>
            </div>
            <DialogTitle>{question.question}</DialogTitle>
          </DialogHeader>
          <div className="question-detail">
          <p>{question.detail}</p>
          {question.privateReply && (
            <div className="private-reply">
              <LockKeyhole />
              <span>
                <strong>Private note from HR</strong>
                {question.privateReply}
              </span>
            </div>
          )}
          {question.owned &&
            question.status === 'Needs clarification' &&
            question.privateReply && (
              <form className="clarification-composer" onSubmit={sendClarification}>
                <label htmlFor={`clarification-${question.id}`}>
                  Reply privately to HR
                </label>
                <Textarea
                  id={`clarification-${question.id}`}
                  value={clarificationDraft}
                  onChange={(event) => setClarificationDraft(event.target.value)}
                  placeholder="Add the missing context without identifying yourself…"
                  maxLength={4000}
                />
                <Button type="submit" disabled={!clarificationDraft.trim()}>
                  Send clarification <Send />
                </Button>
              </form>
            )}
          {question.employeeReply && (
            <div className="employee-reply">
              <MessageCircle />
              <span>
                <strong>Your private reply</strong>
                {question.employeeReply}
              </span>
            </div>
          )}
          {question.answer && (
            <div className="answer-block">
              <UserRoundCheck />
              <span>
                <strong>Official answer · {question.responder}</strong>
                {question.answer}
              </span>
            </div>
          )}
          <footer>
            <button
              type="button"
              disabled={
                votePending ||
                (question.status !== 'Assigned' &&
                  question.status !== 'Answered')
              }
              onClick={() => vote(question.id, 'up')}
              className={question.myVote === 'up' ? 'vote-active' : ''}
              aria-pressed={question.myVote === 'up'}
              aria-label="Upvote this question"
            >
              <ThumbsUp />
              {question.upvotes}
            </button>
            {(question.status === 'Assigned' || question.status === 'Answered') && (
              <button
                type="button"
                onClick={() => setReportTarget({ type: 'question', id: question.id })}
              >
                <Flag /> Report
              </button>
            )}
            <button
              type="button"
              disabled={
                votePending ||
                (question.status !== 'Assigned' &&
                  question.status !== 'Answered')
              }
              onClick={() => vote(question.id, 'down')}
              className={question.myVote === 'down' ? 'vote-active' : ''}
              aria-pressed={question.myVote === 'down'}
              aria-label="Downvote this question"
            >
              <ThumbsDown />
              {question.dislikes}
            </button>
            <button
              type="button"
              className={showThoughts ? 'thoughts-active' : ''}
              onClick={toggleThoughts}
              aria-expanded={showThoughts}
              aria-controls={`thoughts-${question.id}`}
            >
              <MessageCircle />
              {question.comments} thoughts
            </button>
          </footer>
          {showThoughts && (
            <section className="thoughts-panel" id={`thoughts-${question.id}`}>
              <div className="thoughts-heading">
                <div>
                  <strong>Anonymous thoughts</strong>
                  <span>Add context without attaching your identity.</span>
                </div>
              </div>
              {thoughtsLoading ? (
                <p className="thoughts-empty">Loading thoughts…</p>
              ) : thoughts && thoughts.length > 0 ? (
                <div className="thought-list">
                  {thoughts.map((thought) => (
                    <article key={thought.id}>
                      <p>{thought.body}</p>
                      <span>
                        Anonymous · {thought.age}
                        <button
                          type="button"
                          onClick={() => setReportTarget({ type: 'thought', id: thought.id })}
                        >
                          Report
                        </button>
                      </span>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="thoughts-empty">
                  No thoughts yet. Add the first useful perspective.
                </p>
              )}
              <form className="thought-composer" onSubmit={addThought}>
                <Textarea
                  value={thoughtDraft}
                  onChange={(event) => setThoughtDraft(event.target.value)}
                  placeholder="Add an anonymous thought…"
                  aria-label="Anonymous thought"
                  maxLength={2000}
                />
                <Button
                  type="submit"
                  disabled={!thoughtDraft.trim() || thoughtSubmitting}
                >
                  {thoughtSubmitting ? 'Adding…' : 'Add thought'}
                  <Send />
                </Button>
              </form>
            </section>
          )}
          {reportTarget && (
            <form className="report-composer" onSubmit={sendReport}>
              <label htmlFor={`report-${question.id}`}>Why should HR review this content?</label>
              <Textarea
                id={`report-${question.id}`}
                value={reportReason}
                onChange={(event) => setReportReason(event.target.value)}
                placeholder="Describe the safety, privacy, or conduct concern…"
                maxLength={1000}
              />
              <div>
                <Button type="button" variant="outline" onClick={() => setReportTarget(undefined)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={reportReason.trim().length < 3}>
                  Submit report
                </Button>
              </div>
            </form>
          )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

type HrProps = {
  questions: Question[];
  selectedId: number;
  privateReply: string;
  responder: string;
  responders: string[];
  pending: boolean;
  setSelectedId: (id: number) => void;
  setPrivateReply: (value: string) => void;
  setResponder: (value: string) => void;
  requestClarification: (id: number) => void;
  closeQuestion: (id: number) => void;
  approveAndAssign: (id: number) => void;
  thoughtsByQuestion: Record<number, Thought[]>;
  thoughtsLoadingId: number | null;
  loadThoughts: (id: number) => Promise<void>;
  moderateThought: (
    questionId: number,
    thoughtId: number,
    action: 'hide' | 'publish' | 'delete',
  ) => Promise<void>;
  hrThreads: Record<number, { privateReply?: string; employeeReply?: string }>;
  reportCounts: Record<number, number>;
  moderateQuestionVisibility: (
    id: number,
    action: 'hide' | 'delete' | 'restore',
  ) => Promise<void>;
};
function HrView(props: HrProps) {
  const [section, setSection] = useState<'pending' | 'approved' | 'hidden'>('pending');
  const pending = props.questions.filter(
    (question) => question.moderationState !== 'hidden' && question.moderationState !== 'deleted' &&
      (question.status === 'Under review' || question.status === 'Needs clarification' || Boolean(props.reportCounts[question.id])),
  );
  const approved = props.questions.filter(
    (question) => question.moderationState !== 'hidden' && question.moderationState !== 'deleted' &&
      (question.status === 'Assigned' || question.status === 'Answered'),
  );
  const hidden = props.questions.filter(
    (question) => question.moderationState === 'hidden' || question.moderationState === 'deleted' || question.status === 'Closed',
  );
  const queue = section === 'pending' ? pending : section === 'approved' ? approved : hidden;
  const selected =
    queue.find((question) => question.id === props.selectedId) ?? queue[0];
  const selectedThread = selected ? props.hrThreads[selected.id] : undefined;
  const selectedThoughts = selected
    ? props.thoughtsByQuestion[selected.id]
    : undefined;
  return (
    <div className="workspace-page page-shell">
      <header className="workspace-heading">
        <div>
          <p className="eyebrow">HR moderation</p>
          <h1>Review, protect, and route.</h1>
          <p>
            Identity is unavailable here. Work only with the words the employee
            submitted.
          </p>
        </div>
        <span>
          <EyeOff />
          No sender identity
        </span>
      </header>
      <nav className="moderation-tabs" aria-label="HR question sections">
        <button type="button" className={section === 'pending' ? 'active' : ''} onClick={() => setSection('pending')}>
          Waiting <span>{pending.length}</span>
        </button>
        <button type="button" className={section === 'approved' ? 'active' : ''} onClick={() => setSection('approved')}>
          Approved <span>{approved.length}</span>
        </button>
        <button type="button" className={section === 'hidden' ? 'active' : ''} onClick={() => setSection('hidden')}>
          Hidden & deleted <span>{hidden.length}</span>
        </button>
      </nav>
      <div className="work-layout">
        <aside className="work-queue">
          <header>
            <strong>{section === 'pending' ? 'Waiting for review' : section === 'approved' ? 'Approved questions' : 'Further scrutiny'}</strong>
            <span>{queue.length}</span>
          </header>
          {queue.map((question) => (
            <button
              type="button"
              key={question.id}
              className={selected?.id === question.id ? 'active' : ''}
              onClick={() => props.setSelectedId(question.id)}
            >
              <span>{questionReference(question)}</span>
              <strong>{question.question}</strong>
              <small>
                {question.status} · {question.age}
                {props.reportCounts[question.id]
                  ? ` · ${props.reportCounts[question.id]} reports`
                  : ''}
              </small>
            </button>
          ))}
        </aside>
        {selected ? (
          <section className="work-detail">
            <div className="record-meta">
              <span>{questionReference(selected)}</span>
              <span
                className={`status status-${selected.status.toLowerCase().replaceAll(' ', '-')}`}
              >
                {selected.status}
              </span>
            </div>
            <h2>{selected.question}</h2>
            <blockquote>{selected.detail}</blockquote>
            <div className="privacy-boundary">
              <ShieldCheck />
              <span>
                <strong>What HR can see</strong>Question, context, activity, and
                private thread. No email, employee ID, IP address, or device
                details.
              </span>
            </div>
            {selectedThread?.employeeReply && (
              <div className="employee-reply">
                <MessageCircle />
                <span>
                  <strong>Anonymous employee clarification</strong>
                  {selectedThread.employeeReply}
                </span>
              </div>
            )}
            {props.reportCounts[selected.id] ? (
              <div className="report-alert">
                <Flag />
                <span>
                  <strong>{props.reportCounts[selected.id]} open report{props.reportCounts[selected.id] === 1 ? '' : 's'}</strong>
                  Review the question and thoughts for privacy, safety, or conduct concerns.
                </span>
              </div>
            ) : null}
            <div className="thought-moderation">
              <strong>Thought moderation</strong>
              {props.thoughtsLoadingId === selected.id ? (
                <p>Loading thoughts…</p>
              ) : selectedThoughts === undefined ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void props.loadThoughts(selected.id)}
                >
                  Load thoughts
                </Button>
              ) : selectedThoughts.length ? (
                selectedThoughts.map((thought) => (
                  <article key={thought.id} className={thought.status === 'hidden' ? 'hidden-thought' : ''}>
                    <p>{thought.body}</p>
                    <span>{thought.status} · {thought.age}</span>
                    <div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void props.moderateThought(
                          selected.id,
                          thought.id,
                          thought.status === 'hidden' ? 'publish' : 'hide',
                        )}
                      >
                        {thought.status === 'hidden' ? 'Restore' : 'Hide'}
                      </Button>
                      <button
                        type="button"
                        className="delete-thought"
                        onClick={() => void props.moderateThought(selected.id, thought.id, 'delete')}
                      >
                        Delete permanently
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <p>No thoughts on this question.</p>
              )}
            </div>
            {section === 'pending' && (
              <>
                <div className="moderation-section">
                  <label htmlFor="private-reply">Need more information?</label>
                  <Textarea id="private-reply" value={props.privateReply} onChange={(event) => props.setPrivateReply(event.target.value)} placeholder="Ask a private follow-up without learning who sent it…" />
                  <Button type="button" variant="outline" disabled={!props.privateReply.trim() || props.pending} onClick={() => props.requestClarification(selected.id)}>
                    {props.pending ? 'Saving…' : 'Send privately'}
                  </Button>
                </div>
                <div className="assignment-row">
                  <label htmlFor="responder">Approve and assign to</label>
                  <select id="responder" value={props.responder} onChange={(event) => props.setResponder(event.target.value)}>
                    {props.responders.map((item) => <option key={item}>{item}</option>)}
                    {props.responders.length === 0 && <option value="">No responders configured</option>}
                  </select>
                </div>
                <footer className="decision-row">
                  <button type="button" className="close-action" disabled={props.pending} onClick={() => props.closeQuestion(selected.id)}>Reject or close</button>
                  <Button type="button" disabled={!props.responder || props.pending} onClick={() => props.approveAndAssign(selected.id)}>
                    {props.pending ? 'Saving…' : 'Approve and assign'} <ArrowRight />
                  </Button>
                </footer>
              </>
            )}
            {section === 'approved' && (
              <footer className="decision-row moderation-actions">
                <span>Assigned to <strong>{selected.responder ?? '—'}</strong></span>
                <Button type="button" variant="outline" onClick={() => void props.moderateQuestionVisibility(selected.id, 'hide')}>Hide for scrutiny</Button>
              </footer>
            )}
            {section === 'hidden' && (
              <footer className="decision-row moderation-actions">
                <span className="status">{selected.moderationState ?? selected.status}</span>
                <div>
                  <Button type="button" variant="outline" onClick={() => void props.moderateQuestionVisibility(selected.id, 'restore')}>Restore</Button>
                  {selected.moderationState !== 'deleted' && (
                    <button type="button" className="close-action" onClick={() => void props.moderateQuestionVisibility(selected.id, 'delete')}>Move to deleted</button>
                  )}
                </div>
              </footer>
            )}
          </section>
        ) : (
          <section className="work-detail empty-work-state">
            <ShieldCheck />
            <h2>Nothing in this section.</h2>
            <p>Choose another section or wait for new activity.</p>
          </section>
        )}
      </div>
    </div>
  );
}

type ResponderProps = {
  questions: Question[];
  selectedId: number;
  answer: string;
  responderLabel: string;
  pending: boolean;
  setSelectedId: (id: number) => void;
  setAnswer: (value: string) => void;
  publishAnswer: (id: number) => void;
};
function ResponderView(props: ResponderProps) {
  const assigned = props.questions.filter(
    (question) =>
      question.status === 'Assigned' &&
      question.responder === props.responderLabel &&
      !question.owned &&
      question.moderationState !== 'hidden' &&
      question.moderationState !== 'deleted',
  );
  const ownAssigned = props.questions.filter(
    (question) => question.status === 'Assigned' && question.responder === props.responderLabel && question.owned,
  );
  const answered = props.questions.filter(
    (question) => question.status === 'Answered' && question.responder === props.responderLabel && question.moderationState !== 'hidden' && question.moderationState !== 'deleted',
  );
  const selected =
    assigned.find((question) => question.id === props.selectedId) ??
    assigned[0];
  return (
    <div className="workspace-page page-shell">
      <header className="workspace-heading">
        <div>
          <p className="eyebrow">Responder</p>
          <h1>Answer what has been assigned.</h1>
          <p>
            You have normal employee access plus responsibility for these
            questions.
          </p>
        </div>
        <span>
          <UserRoundCheck />
          {props.responderLabel || 'Responder'}
        </span>
      </header>
      <div className="work-layout">
        <aside className="work-queue">
          <header>
            <strong>Assigned to you</strong>
            <span>{assigned.length}</span>
          </header>
          {assigned.map((question) => (
            <button
              type="button"
              key={question.id}
              className={selected.id === question.id ? 'active' : ''}
              onClick={() => props.setSelectedId(question.id)}
            >
              <span>{questionReference(question)}</span>
              <strong>{question.question}</strong>
              <small>{question.age}</small>
            </button>
          ))}
        </aside>
        {selected ? (
          <section className="work-detail response-work">
            <div className="record-meta">
              <span>{questionReference(selected)}</span>
              <span className="status status-assigned">Assigned</span>
            </div>
            <h2>{selected.question}</h2>
            <blockquote>{selected.detail}</blockquote>
            <div className="privacy-boundary">
              <EyeOff />
              <span>
                <strong>Anonymous context</strong>
                {selected.upvotes} people support this question and{' '}
                {selected.comments} added thoughts. Their identities are not
                available.
              </span>
            </div>
            <div className="answer-editor">
              <label htmlFor="answer">Your official answer</label>
              <Textarea
                id="answer"
                value={props.answer}
                onChange={(event) => props.setAnswer(event.target.value)}
                placeholder="Give a direct answer. Explain the decision and what happens next…"
              />
            </div>
            <footer className="decision-row">
              <span>
                <Send />
                Published answers are visible to employees.
              </span>
              <Button
                type="button"
                disabled={!props.answer.trim() || props.pending}
                onClick={() => props.publishAnswer(selected.id)}
              >
                {props.pending ? 'Publishing…' : 'Publish answer'}
                <ArrowRight />
              </Button>
            </footer>
          </section>
        ) : (
          <section className="work-detail empty-work-state">
            <UserRoundCheck />
            <h2>No questions are assigned to you.</h2>
            <p>Questions will appear here after HR approves and routes them.</p>
          </section>
        )}
      </div>
      {ownAssigned.length > 0 && (
        <div className="self-answer-warning">
          <ShieldCheck /> {ownAssigned.length} question{ownAssigned.length === 1 ? '' : 's'} you submitted {ownAssigned.length === 1 ? 'is' : 'are'} hidden from your responder queue so you cannot answer your own question.
        </div>
      )}
      <section className="answered-history">
        <header>
          <div><p className="eyebrow">Answer history</p><h2>Questions you answered</h2></div>
          <span>{answered.length}</span>
        </header>
        {answered.length ? answered.map((question) => (
          <article key={question.id}>
            <span className="status status-answered">Answered</span>
            <div><strong>{question.question}</strong><p>{question.answer}</p></div>
          </article>
        )) : <p className="history-empty">Published answers will appear here.</p>}
      </section>
    </div>
  );
}

function AnalyticsView({
  analytics,
  period,
  setPeriod,
}: {
  analytics: Analytics | null;
  period: 'week' | 'month';
  setPeriod: (period: 'week' | 'month') => void;
}) {
  const max = Math.max(1, ...(analytics?.trend.map((item) => item.count) ?? [1]));
  return (
    <div className="analytics-page page-shell">
      <header className="workspace-heading">
        <div>
          <p className="eyebrow">HR analytics</p>
          <h1>Understand what needs attention.</h1>
          <p>Aggregate operational metrics only. No sender identity is included.</p>
        </div>
        <div className="period-toggle">
          <button type="button" className={period === 'week' ? 'active' : ''} onClick={() => setPeriod('week')}>Weekly</button>
          <button type="button" className={period === 'month' ? 'active' : ''} onClick={() => setPeriod('month')}>Monthly</button>
        </div>
      </header>
      <div className="metric-grid">
        <article><span>Total questions</span><strong>{analytics?.total ?? '—'}</strong></article>
        <article><span>Answered</span><strong>{analytics?.answered ?? '—'}</strong></article>
        <article><span>Pending</span><strong>{analytics?.pending ?? '—'}</strong></article>
        <article><span>Average answer time</span><strong>{analytics ? `${analytics.average_answer_hours}h` : '—'}</strong></article>
      </div>
      <section className="analytics-card trend-card">
        <div><p className="eyebrow">Question volume</p><h2>{period === 'week' ? 'Weekly' : 'Monthly'} questions</h2></div>
        <div className="trend-bars">
          {(analytics?.trend ?? []).map((item) => (
            <div key={item.period}>
              <span style={{ height: `${Math.max(8, (item.count / max) * 100)}%` }} title={`${item.count} questions`} />
              <strong>{item.count}</strong>
              <small>{new Date(item.period).toLocaleDateString(undefined, period === 'week' ? { month: 'short', day: 'numeric' } : { month: 'short' })}</small>
            </div>
          ))}
        </div>
      </section>
      <div className="insight-grid">
        <InsightCard title="Most liked" item={analytics?.most_liked} icon={<ThumbsUp />} />
        <InsightCard title="Most disliked" item={analytics?.most_disliked} icon={<ThumbsDown />} />
        <InsightCard title="Most discussed" item={analytics?.most_discussed} icon={<MessageCircle />} />
      </div>
    </div>
  );
}

function InsightCard({ title, item, icon }: { title: string; item?: Analytics['most_liked']; icon: ReactNode }) {
  return (
    <article className="analytics-card insight-card">
      <div>{icon}<span>{title}</span><strong>{item?.value ?? 0}</strong></div>
      <p>{item?.question ?? 'No question data yet.'}</p>
    </article>
  );
}
