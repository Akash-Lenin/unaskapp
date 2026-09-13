'use client';

import {
  type SyntheticEvent,
  useEffect,
  useMemo,
  useState,
} from 'react';
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
type Status =
  | 'Under review'
  | 'Needs clarification'
  | 'Assigned'
  | 'Answered'
  | 'Closed';
type Visibility = 'anonymous' | 'named';
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
  displayName?: string;
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

const responders = [
  'Maya · People Leadership',
  'Arjun · Revenue Operations',
  'Leena · Enablement',
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
    displayName: row.display_name ?? undefined,
    persisted: true,
  };
}

export default function HomePage() {
  const [auth, setAuth] = useState<'signin' | 'accepted' | 'denied' | 'app'>(
    'signin',
  );
  const [sessionId, setSessionId] = useState('');
  const [role, setRole] = useState<Role>('employee');
  const [questions, setQuestions] = useState(seed);
  const [selectedId, setSelectedId] = useState(2829);
  const [draft, setDraft] = useState('');
  const [detail, setDetail] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('anonymous');
  const [displayName, setDisplayName] = useState('');
  const [search, setSearch] = useState('');
  const [answer, setAnswer] = useState('');
  const [privateReply, setPrivateReply] = useState('');
  const [responder, setResponder] = useState(responders[0]);
  const [expandedId, setExpandedId] = useState<number | null>(2836);
  const [toast, setToast] = useState('');
  const [showProof, setShowProof] = useState(true);
  const [backendState, setBackendState] = useState<
    'connecting' | 'live' | 'error'
  >('connecting');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const request = supabase
      .from('questions')
      .select(
        'id, question, detail, status, visibility, display_name, upvotes, dislikes, comments_count, responder_label, answer, created_at, updated_at',
      )
      .order('created_at', { ascending: false });

    void request.then(({ data, error }) => {
      if (error) {
        setBackendState('error');
        return;
      }

      const liveQuestions = (data ?? []).map((row) =>
        rowToQuestion(row as PublicQuestionRow),
      );
      setQuestions((current) => [
        ...liveQuestions,
        ...current.filter(
          (question) =>
            question.status !== 'Assigned' && question.status !== 'Answered',
        ),
      ]);
      setBackendState('live');
    });
  }, []);

  const risks = useMemo(
    () =>
      identityPatterns.flatMap(([pattern, warning]) => {
        pattern.lastIndex = 0;
        return pattern.test(`${draft} ${detail}`) ? [warning] : [];
      }),
    [draft, detail],
  );

  const selected =
    questions.find((question) => question.id === selectedId) ?? questions[0];
  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2600);
  };

  const testLogin = (kind: 'company' | 'personal') => {
    if (kind === 'personal') {
      setAuth('denied');
      return;
    }
    setSessionId(randomToken('ses'));
    setAuth('accepted');
  };

  const signOut = () => {
    setAuth('signin');
    setSessionId('');
    setRole('employee');
  };

  const submitQuestion = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.trim() || submitting) return;
    setSubmitting(true);
    const threadKey = randomToken('thr');
    const localId = Date.now();
    const { error } = await supabase.from('questions').insert({
      question: draft.trim(),
      detail: detail.trim(),
      visibility,
      display_name:
        visibility === 'named'
          ? displayName.trim() || 'Name entered by author'
          : undefined,
      thread_key: threadKey,
    });

    if (error) {
      setSubmitting(false);
      setBackendState('error');
      notify('The question could not be saved. Please try again.');
      return;
    }

    const question: Question = {
      id: localId,
      question: draft.trim(),
      detail: detail.trim() || 'No additional context was added.',
      status: 'Under review',
      age: 'Just now',
      upvotes: 0,
      dislikes: 0,
      comments: 0,
      owned: true,
      displayName:
        visibility === 'named'
          ? displayName.trim() || 'Name entered by author'
          : undefined,
      threadKey,
      persisted: true,
    };
    setQuestions((current) => [question, ...current]);
    setSelectedId(question.id);
    setExpandedId(question.id);
    setDraft('');
    setDetail('');
    setDisplayName('');
    setVisibility('anonymous');
    setSubmitting(false);
    setBackendState('live');
    notify(
      `Question ${questionReference(question)} entered the private HR queue.`,
    );
  };

  const vote = async (id: number, direction: 'up' | 'down') => {
    const previous = questions.find((question) => question.id === id);
    if (!previous) return;
    if (previous.status !== 'Assigned' && previous.status !== 'Answered') {
      notify('Voting opens after HR publishes the question.');
      return;
    }
    setQuestions((current) =>
      current.map((question) =>
        question.id === id
          ? {
              ...question,
              upvotes: question.upvotes + (direction === 'up' ? 1 : 0),
              dislikes: question.dislikes + (direction === 'down' ? 1 : 0),
            }
          : question,
      ),
    );
    const { data, error } = await supabase.rpc('vote_question', {
      p_question_id: id,
      p_direction: direction,
    });
    const totals = data?.[0];
    if (error || !totals) {
      setQuestions((current) =>
        current.map((question) =>
          question.id === id ? previous : question,
        ),
      );
      notify('That vote could not be saved. Please try again.');
      return;
    }
    setQuestions((current) =>
      current.map((question) =>
        question.id === id
          ? {
              ...question,
              upvotes: totals.upvotes,
              dislikes: totals.dislikes,
            }
          : question,
      ),
    );
  };

  const requestClarification = () => {
    if (!privateReply.trim()) return;
    setQuestions((current) =>
      current.map((question) =>
        question.id === selected.id
          ? {
              ...question,
              status: 'Needs clarification',
              privateReply: privateReply.trim(),
            }
          : question,
      ),
    );
    setPrivateReply('');
    notify('Private clarification sent through the anonymous thread.');
  };

  const closeQuestion = () => {
    setQuestions((current) =>
      current.map((question) =>
        question.id === selected.id
          ? { ...question, status: 'Closed' }
          : question,
      ),
    );
    notify('Question closed privately.');
  };

  const approveAndAssign = () => {
    setQuestions((current) =>
      current.map((question) =>
        question.id === selected.id
          ? { ...question, status: 'Assigned', responder }
          : question,
      ),
    );
    notify(`Approved and assigned to ${responder.split(' · ')[0]}.`);
  };

  const publishAnswer = (id: number) => {
    if (!answer.trim()) return;
    setQuestions((current) =>
      current.map((question) =>
        question.id === id
          ? { ...question, status: 'Answered', answer: answer.trim() }
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
        sessionId={sessionId}
        testLogin={testLogin}
        enter={() => setAuth('app')}
        reset={() => setAuth('signin')}
      />
    );

  return (
    <main className="unask-app">
      <Header
        role={role}
        setRole={setRole}
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
          visibility={visibility}
          displayName={displayName}
          search={search}
          risks={risks}
          expandedId={expandedId}
          setDraft={setDraft}
          setDetail={setDetail}
          setVisibility={setVisibility}
          setDisplayName={setDisplayName}
          setSearch={setSearch}
          setExpandedId={setExpandedId}
          submit={submitQuestion}
          vote={vote}
          submitting={submitting}
        />
      )}
      {role === 'hr' && (
        <HrView
          questions={questions}
          selected={selected}
          selectedId={selectedId}
          privateReply={privateReply}
          responder={responder}
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
          selected={selected}
          selectedId={selectedId}
          answer={answer}
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
  sessionId,
  testLogin,
  enter,
  reset,
}: {
  state: 'signin' | 'accepted' | 'denied';
  sessionId: string;
  testLogin: (kind: 'company' | 'personal') => void;
  enter: () => void;
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
        <small>Development anonymity test · no real Google login yet</small>
      </section>
      <section className="auth-panel">
        {state === 'signin' && (
          <div className="auth-card">
            <ShieldCheck className="auth-icon" />
            <p className="eyebrow">Anonymity handoff test</p>
            <h2>Check who can enter</h2>
            <p>
              Choose a test account. The company account should create an
              anonymous session. A personal account should be refused.
            </p>
            <button
              className="google-button"
              onClick={() => testLogin('company')}
            >
              <span>G</span>Continue with company account
              <ArrowRight />
            </button>
            <button
              className="text-button"
              onClick={() => testLogin('personal')}
            >
              Try a personal account
            </button>
            <div className="auth-note">
              <LockKeyhole />
              This screen simulates Google SSO. No password or email is
              collected.
            </div>
          </div>
        )}
        {state === 'accepted' && (
          <div className="auth-card proof-card">
            <span className="result-icon success">
              <Check />
            </span>
            <p className="eyebrow">Access confirmed</p>
            <h2>Identity stopped here.</h2>
            <div className="proof-list">
              <ProofRow label="Company domain confirmed" value="Passed" />
              <ProofRow label="Role resolved" value="Employee" />
              <ProofRow label="Email in app session" value="Absent" />
              <ProofRow label="Provider token" value="Discarded" />
              <ProofRow
                label="Anonymous session"
                value={`${sessionId.slice(0, 8)}••••`}
              />
            </div>
            <Button onClick={enter}>
              Enter Unask
              <ArrowRight />
            </Button>
            <button className="text-button" onClick={reset}>
              Run another test
            </button>
          </div>
        )}
        {state === 'denied' && (
          <div className="auth-card proof-card">
            <span className="result-icon denied">×</span>
            <p className="eyebrow">Access refused</p>
            <h2>This workspace is for Everstage employees.</h2>
            <p>
              The personal account was rejected before an Unask session was
              created.
            </p>
            <Button variant="outline" onClick={reset}>
              Try another account
            </Button>
          </div>
        )}
      </section>
    </main>
  );
}

function ProofRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>
        <Check />
        {label}
      </span>
      <strong>{value}</strong>
    </div>
  );
}

function Header({
  role,
  setRole,
  sessionId,
  signOut,
  backendState,
}: {
  role: Role;
  setRole: (role: Role) => void;
  sessionId: string;
  signOut: () => void;
  backendState: 'connecting' | 'live' | 'error';
}) {
  return (
    <header className="unask-header">
      <Brand />
      <div className="prototype-role">
        <label htmlFor="prototype-role">Prototype view</label>
        <select
          id="prototype-role"
          value={role}
          onChange={(event) => setRole(event.target.value as Role)}
        >
          <option value="employee">Employee</option>
          <option value="hr">HR Admin</option>
          <option value="responder">Responder</option>
        </select>
      </div>
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
        <button onClick={signOut} aria-label="End test session">
          <LogOut />
        </button>
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
        <strong>Anonymity test passed.</strong> Company access confirmed; email
        is absent from session {sessionId.slice(0, 8)}••••.
      </span>
      <button onClick={close}>Dismiss</button>
    </div>
  );
}

type EmployeeProps = {
  questions: Question[];
  draft: string;
  detail: string;
  visibility: Visibility;
  displayName: string;
  search: string;
  risks: string[];
  expandedId: number | null;
  setDraft: (value: string) => void;
  setDetail: (value: string) => void;
  setVisibility: (value: Visibility) => void;
  setDisplayName: (value: string) => void;
  setSearch: (value: string) => void;
  setExpandedId: (value: number | null) => void;
  submit: (event: SyntheticEvent<HTMLFormElement>) => void;
  vote: (id: number, direction: 'up' | 'down') => void;
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
            <div className="visibility-choice">
              <span>Show this as</span>
              <button
                type="button"
                className={props.visibility === 'anonymous' ? 'active' : ''}
                onClick={() => props.setVisibility('anonymous')}
              >
                Anonymous
              </button>
              <button
                type="button"
                className={props.visibility === 'named' ? 'active' : ''}
                onClick={() => props.setVisibility('named')}
              >
                With a name
              </button>
            </div>
            {props.visibility === 'named' && (
              <input
                className="name-input"
                value={props.displayName}
                onChange={(event) => props.setDisplayName(event.target.value)}
                placeholder="Enter a display name"
                aria-label="Display name"
              />
            )}
            <Button disabled={!props.draft.trim() || props.submitting}>
              {props.submitting ? 'Saving…' : 'Send to HR'}
              <ArrowRight />
            </Button>
          </footer>
        </form>
        <p className="editor-footnote">
          <LockKeyhole />A new private thread is created for this question. It
          is not linked to your login or other questions.
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
}: {
  question: Question;
  expanded: boolean;
  toggle: () => void;
  vote: (id: number, direction: 'up' | 'down') => void;
}) {
  return (
    <article className={`question-row ${expanded ? 'expanded' : ''}`}>
      <button className="question-main" onClick={toggle}>
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
        <p>
          {question.displayName
            ? `${question.displayName} · name entered by author`
            : 'Anonymous'}{' '}
          · {question.age}
        </p>
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
              disabled={
                question.status !== 'Assigned' &&
                question.status !== 'Answered'
              }
              onClick={() => vote(question.id, 'up')}
            >
              <ThumbsUp />
              {question.upvotes}
            </button>
            <button
              disabled={
                question.status !== 'Assigned' &&
                question.status !== 'Answered'
              }
              onClick={() => vote(question.id, 'down')}
            >
              <ThumbsDown />
              {question.dislikes}
            </button>
            <span>
              <MessageCircle />
              {question.comments} thoughts
            </span>
          </footer>
        </div>
      )}
    </article>
  );
}

type HrProps = {
  questions: Question[];
  selected: Question;
  selectedId: number;
  privateReply: string;
  responder: string;
  setSelectedId: (id: number) => void;
  setPrivateReply: (value: string) => void;
  setResponder: (value: string) => void;
  requestClarification: () => void;
  closeQuestion: () => void;
  approveAndAssign: () => void;
};
function HrView(props: HrProps) {
  const queue = props.questions.filter(
    (question) =>
      question.status === 'Under review' ||
      question.status === 'Needs clarification',
  );
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
        <section className="work-detail">
          <div className="record-meta">
            <span>{questionReference(props.selected)}</span>
            <span
              className={`status status-${props.selected.status.toLowerCase().replaceAll(' ', '-')}`}
            >
              {props.selected.status}
            </span>
          </div>
          <h2>{props.selected.question}</h2>
          <blockquote>{props.selected.detail}</blockquote>
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
              variant="outline"
              disabled={!props.privateReply.trim()}
              onClick={props.requestClarification}
            >
              Send privately
            </Button>
          </div>
          <div className="assignment-row">
            <label htmlFor="responder">Approve and assign to</label>
            <select
              id="responder"
              value={props.responder}
              onChange={(event) => props.setResponder(event.target.value)}
            >
              {responders.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>
          <footer className="decision-row">
            <button className="close-action" onClick={props.closeQuestion}>
              Reject or close
            </button>
            <Button onClick={props.approveAndAssign}>
              Approve and assign
              <ArrowRight />
            </Button>
          </footer>
        </section>
      </div>
    </div>
  );
}

type ResponderProps = {
  questions: Question[];
  selected: Question;
  selectedId: number;
  answer: string;
  setSelectedId: (id: number) => void;
  setAnswer: (value: string) => void;
  publishAnswer: (id: number) => void;
};
function ResponderView(props: ResponderProps) {
  const assigned = props.questions.filter(
    (question) =>
      question.status === 'Assigned' && question.responder?.startsWith('Maya'),
  );
  const selected =
    assigned.find((question) => question.id === props.selectedId) ??
    assigned[0] ??
    props.selected;
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
          Maya · People Leadership
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
              disabled={!props.answer.trim()}
              onClick={() => props.publishAnswer(selected.id)}
            >
              Publish answer
              <ArrowRight />
            </Button>
          </footer>
        </section>
      </div>
    </div>
  );
}
