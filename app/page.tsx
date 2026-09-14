'use client';

import { type SyntheticEvent, useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleHelp,
  EyeOff,
  LockKeyhole,
  LogOut,
  MessageCircle,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  UserRoundCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { QuestionRow } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

type Role = 'employee' | 'hr' | 'responder';
type StaffRole = Exclude<Role, 'employee'> | null;
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
  owned?: boolean;
  myVote?: VoteDirection;
  threadKey?: string;
  persisted?: boolean;
};

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

function isEverstageEmail(value: string | undefined) {
  return /^[^@\s]+@everstage\.com$/i.test(value ?? '');
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

  useEffect(() => {
    const applyUser = (user: User | null) => {
      if (user && isGoogleUser(user) && isEverstageEmail(user.email)) {
        setSessionId((current) => current || randomToken('ses'));
        setAuth('app');
        return;
      }

      if (user) {
        setAuth('denied');
        void supabase.auth.signOut({ scope: 'local' });
        return;
      }

      setAuth((current) => (current === 'denied' ? current : 'signin'));
    };

    void supabase.auth.getUser().then(({ data }) => {
      applyUser(data.user);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      applyUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
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
      setResponderLabel(nextResponderLabel);
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
          'id, question, detail, status, visibility, display_name, upvotes, dislikes, comments_count, responder_label, answer, created_at, updated_at',
        )
        .order('created_at', { ascending: false });
      if (error) {
        setBackendState('error');
        return;
      }

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
      const threadKeys = Object.keys(sessionStorage).filter((key) =>
        /^unask[.]thread[.]\d+$/.test(key),
      );
      const ownedQuestions = await Promise.all(
        threadKeys.map(async (storageKey) => {
          const id = Number(storageKey.slice('unask.thread.'.length));
          const token = sessionStorage.getItem(storageKey);
          if (!token || !Number.isSafeInteger(id)) return null;
          const threadHash = await hashToken(token);
          const { data: threadData } = await supabase.rpc(
            'get_unask_question_thread',
            { p_question_id: id, p_thread_hash: threadHash },
          );
          const row = threadData?.[0];
          if (!row) return null;
          return {
            ...rowToQuestion(row as PublicQuestionRow),
            privateReply: row.private_reply ?? undefined,
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
          hd: 'everstage.com',
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

    sessionStorage.setItem(`unask.thread.${saved.id}`, threadKey);

    const question: Question = {
      ...rowToQuestion(saved as PublicQuestionRow),
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

  const loadThoughts = async (questionId: number) => {
    setThoughtsLoadingId(questionId);
    const { data, error } = await supabase
      .from('question_thoughts')
      .select('id, body, created_at')
      .eq('question_id', questionId)
      .eq('status', 'published')
      .order('created_at', { ascending: true });
    setThoughtsLoadingId(null);
    if (error) {
      notify('Thoughts could not be loaded. Please try again.');
      return;
    }
    const thoughts = (data ?? []).map((thought) => ({
      id: thought.id,
      body: thought.body,
      age: relativeAge(thought.created_at),
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
        <ProofStrip sessionId={sessionId} close={() => setShowProof(false)} />
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
          Verified company access · identity is separated from feedback
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
              Use your Everstage Google Workspace account. Personal Google
              accounts and other company domains are refused.
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
              Google verifies company membership. Feedback omits your email and
              employee ID; voting uses a one-per-question pseudonymous marker.
            </div>
          </div>
        )}
        {state === 'denied' && (
          <div className="auth-card proof-card">
            <span className="result-icon denied">×</span>
            <p className="eyebrow">Access refused</p>
            <h2>This workspace is for Everstage employees.</h2>
            <p>
              Use an Everstage Google Workspace account ending exactly in
              @everstage.com. No application access or feedback data was
              granted.
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
        <label htmlFor="workspace-role">Workspace</label>
        <select
          id="workspace-role"
          value={role}
          onChange={(event) => setRole(event.target.value as Role)}
        >
          <option value="employee">Employee</option>
          {staffRole === 'hr' && <option value="hr">HR Admin</option>}
          {staffRole === 'responder' && (
            <option value="responder">Responder</option>
          )}
        </select>
      </div>
    </header>
  );
}

function ProofStrip({
  sessionId,
  close,
}: {
  sessionId: string;
  close: () => void;
}) {
  return (
    <div className="proof-strip">
      <ShieldCheck />
      <span>
        <strong>Verified Everstage access.</strong> Google and Supabase Auth
        keep your email and profile for sign-in. Questions and thoughts do not
        store your email or employee ID. Voting uses a per-question pseudonymous
        marker, and anonymous thread recovery uses browser-held session{' '}
        {sessionId.slice(0, 8)}••••.
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
  submitting: boolean;
};

function EmployeeView(props: EmployeeProps) {
  const visible = props.questions.filter(
    (question) =>
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
          <div className="quiet-promise">
            <EyeOff />
            <span>
              <strong>Your identity is not attached.</strong> HR receives only
              what you write below.
            </span>
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
              {props.submitting ? 'Saving…' : 'Send to HR'}
              <ArrowRight />
            </Button>
          </footer>
        </form>
        <p className="editor-footnote">
          <LockKeyhole />A private recovery key stays in this browser tab. If
          you want to identify yourself, include your name in the message body.
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
            />
          ))}
        </div>
      </section>
    </div>
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
}) {
  const [showThoughts, setShowThoughts] = useState(false);
  const [thoughtDraft, setThoughtDraft] = useState('');

  const toggleThoughts = () => {
    const opening = !showThoughts;
    setShowThoughts(opening);
    if (opening && thoughts === undefined) void loadThoughts();
  };

  const addThought = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (await submitThought(thoughtDraft)) setThoughtDraft('');
  };

  return (
    <article className={`question-row ${expanded ? 'expanded' : ''}`}>
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
      {expanded && (
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
                      <span>Anonymous · {thought.age}</span>
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
        </div>
      )}
    </article>
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
};
function HrView(props: HrProps) {
  const queue = props.questions.filter(
    (question) =>
      question.status === 'Under review' ||
      question.status === 'Needs clarification',
  );
  const selected =
    queue.find((question) => question.id === props.selectedId) ?? queue[0];
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
      <div className="work-layout">
        <aside className="work-queue">
          <header>
            <strong>Waiting for review</strong>
            <span>{queue.length}</span>
          </header>
          {queue.map((question) => (
            <button
              type="button"
              key={question.id}
              className={props.selectedId === question.id ? 'active' : ''}
              onClick={() => props.setSelectedId(question.id)}
            >
              <span>{questionReference(question)}</span>
              <strong>{question.question}</strong>
              <small>
                {question.status} · {question.age}
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
            <div className="moderation-section">
              <label htmlFor="private-reply">Need more information?</label>
              <Textarea
                id="private-reply"
                value={props.privateReply}
                onChange={(event) => props.setPrivateReply(event.target.value)}
                placeholder="Ask a private follow-up without learning who sent it…"
              />
              <Button
                type="button"
                variant="outline"
                disabled={!props.privateReply.trim() || props.pending}
                onClick={() => props.requestClarification(selected.id)}
              >
                {props.pending ? 'Saving…' : 'Send privately'}
              </Button>
            </div>
            <div className="assignment-row">
              <label htmlFor="responder">Approve and assign to</label>
              <select
                id="responder"
                value={props.responder}
                onChange={(event) => props.setResponder(event.target.value)}
              >
                {props.responders.map((item) => (
                  <option key={item}>{item}</option>
                ))}
                {props.responders.length === 0 && (
                  <option value="">No responders configured</option>
                )}
              </select>
            </div>
            <footer className="decision-row">
              <button
                type="button"
                className="close-action"
                disabled={props.pending}
                onClick={() => props.closeQuestion(selected.id)}
              >
                Reject or close
              </button>
              <Button
                type="button"
                disabled={!props.responder || props.pending}
                onClick={() => props.approveAndAssign(selected.id)}
              >
                {props.pending ? 'Saving…' : 'Approve and assign'}
                <ArrowRight />
              </Button>
            </footer>
          </section>
        ) : (
          <section className="work-detail empty-work-state">
            <ShieldCheck />
            <h2>The moderation queue is clear.</h2>
            <p>New employee questions will appear here for private review.</p>
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
      question.responder === props.responderLabel,
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
    </div>
  );
}
