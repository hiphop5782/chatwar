import { useEffect, useRef, useState } from 'react'
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth'
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore'
import { auth, db } from './firebase'

const NICKNAME_KEY = 'chatwar.nickname'
const EMOJI_IDS = Array.from({ length: 111 }, (_, index) => index + 1)
const EMOJI_NAMES = {
  1: '화남', 2: '무표정', 3: '삐짐', 4: '멋짐', 5: '슬픔', 6: '메롱',
  7: '궁금', 8: '하하', 9: '화이팅', 10: '부끄러움', 11: '식은땀',
  12: '수줍음', 13: '윙크', 14: '눈물', 15: '사랑', 16: '웃음',
  17: '부탁', 18: '피곤', 34: '좋아요', 47: '졸림', 62: '정색',
  65: '깔깔', 69: '어지러움', 83: '폭소', 91: '미소', 94: '싫어요',
}
const emojiToken = (emojiId) => `[${EMOJI_NAMES[emojiId] ?? `이모티콘${emojiId}`}]`
const EMOJI_BY_TOKEN = Object.fromEntries(EMOJI_IDS.map((emojiId) => [emojiToken(emojiId), emojiId]))
function getRoomId() {
  return new URLSearchParams(window.location.search).get('room')
}

function formatTime(timestamp) {
  if (!timestamp) return ''
  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

function renderMessageText(messageText) {
  return messageText.split(/(\[[^\]\n]{1,20}\])/g).map((part, index) => {
    const emojiId = EMOJI_BY_TOKEN[part]
    if (!emojiId) return part
    return (
      <img
        className="inline-emoji"
        src={`/emojis/${emojiId}.png`}
        alt={part}
        title={part}
        key={`${part}-${index}`}
      />
    )
  })
}

export default function App() {
  const roomId = getRoomId()
  const [user, setUser] = useState(null)
  const [authError, setAuthError] = useState('')

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, setUser)
    signInAnonymously(auth).catch(() => setAuthError('익명 로그인에 실패했습니다. Firebase 설정을 확인해 주세요.'))
    return unsubscribe
  }, [])

  if (authError) return <StatusPage title="연결할 수 없습니다" description={authError} />
  if (!user) return <StatusPage title="Chatwar" description="채팅 서버에 연결하는 중입니다…" />
  return roomId ? <ChatRoom roomId={roomId} user={user} /> : <CreateRoom user={user} />
}

function CreateRoom({ user }) {
  const [roomName, setRoomName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  async function createRoom(event) {
    event.preventDefault()
    const name = roomName.trim()
    if (!name || creating) return

    setCreating(true)
    setError('')
    try {
      const room = await addDoc(collection(db, 'rooms'), {
        name,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        messages: [],
      })
      window.location.assign(`/?room=${encodeURIComponent(room.id)}`)
    } catch {
      setError('방을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.')
      setCreating(false)
    }
  }

  return (
    <main className="landing-shell">
      <section className="hero-card">
        <span className="brand-mark">CW</span>
        <p className="eyebrow">링크 하나로 바로 시작</p>
        <h1>Chatwar</h1>
        <p className="hero-copy">가입 없이 방을 만들고 주소를 공유하세요. 최근 대화 100개만 가볍게 보관합니다.</p>
        <form className="create-form" onSubmit={createRoom}>
          <label htmlFor="room-name">방 이름</label>
          <div className="input-action">
            <input
              id="room-name"
              maxLength="40"
              placeholder="예: 3054 서버 작전방"
              value={roomName}
              onChange={(event) => setRoomName(event.target.value)}
              autoFocus
            />
            <button disabled={!roomName.trim() || creating}>{creating ? '생성 중…' : '방 만들기'}</button>
          </div>
          {error && <p className="error-text">{error}</p>}
        </form>
      </section>
    </main>
  )
}

function ChatRoom({ roomId, user }) {
  const [room, setRoom] = useState(null)
  const [roomState, setRoomState] = useState('loading')
  const [nickname, setNickname] = useState(() => localStorage.getItem(NICKNAME_KEY) ?? '')
  const [joined, setJoined] = useState(false)
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [copied, setCopied] = useState(false)
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false)
  const bottomRef = useRef(null)
  const messageInputRef = useRef(null)

  useEffect(() => {
    getDoc(doc(db, 'rooms', roomId))
      .then((snapshot) => {
        if (!snapshot.exists()) return setRoomState('missing')
        setRoom({ id: snapshot.id, ...snapshot.data() })
        setRoomState('ready')
      })
      .catch(() => setRoomState('error'))
  }, [roomId])

  useEffect(() => {
    if (roomState !== 'ready' || !joined) return undefined
    return onSnapshot(doc(db, 'rooms', roomId), (snapshot) => {
      if (!snapshot.exists()) return
      setMessages(snapshot.data().messages ?? [])
    })
  }, [joined, roomId, roomState])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function enterRoom(event) {
    event.preventDefault()
    const nextNickname = nickname.trim()
    if (!nextNickname) return
    localStorage.setItem(NICKNAME_KEY, nextNickname)
    setNickname(nextNickname)
    setJoined(true)
  }

  async function appendMessage({ type, messageText = '', emojiId = null }) {
    if (sending) return false
    setSending(true)
    try {
      const roomReference = doc(db, 'rooms', roomId)
      await runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(roomReference)
        if (!snapshot.exists()) throw new Error('Room not found')

        const previousMessages = snapshot.data().messages ?? []
        const nextMessage = {
          id: crypto.randomUUID(),
          uid: user.uid,
          nickname,
          type,
          text: messageText,
          emojiId,
          createdAt: Date.now(),
        }

        transaction.update(roomReference, {
          messages: [...previousMessages, nextMessage].slice(-100),
        })
      })
      return true
    } catch {
      return false
    } finally {
      setSending(false)
    }
  }

  async function sendMessage(event) {
    event.preventDefault()
    const nextText = text.trim()
    if (!nextText || sending) return
    setText('')
    const sent = await appendMessage({ type: 'text', messageText: nextText })
    if (!sent) setText(nextText)
  }

  function insertEmojiToken(emojiId) {
    const input = messageInputRef.current
    const token = emojiToken(emojiId)
    const start = input?.selectionStart ?? text.length
    const end = input?.selectionEnd ?? start
    const nextText = `${text.slice(0, start)}${token}${text.slice(end)}`
    setText(nextText.slice(0, 500))
    setEmojiPickerOpen(false)

    requestAnimationFrame(() => {
      const cursor = Math.min(start + token.length, 500)
      messageInputRef.current?.focus()
      messageInputRef.current?.setSelectionRange(cursor, cursor)
    })
  }

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  if (roomState === 'loading') return <StatusPage title="방을 찾는 중입니다…" />
  if (roomState === 'missing') return <StatusPage title="존재하지 않는 방입니다" description="주소가 정확한지 확인해 주세요." action />
  if (roomState === 'error') return <StatusPage title="방을 불러오지 못했습니다" description="잠시 후 다시 시도해 주세요." action />

  if (!joined) {
    return (
      <main className="landing-shell">
        <section className="join-card">
          <p className="eyebrow">초대받은 채팅방</p>
          <h1>{room.name}</h1>
          <p>대화에서 사용할 닉네임을 입력하세요.</p>
          <form className="join-form" onSubmit={enterRoom}>
            <input maxLength="20" placeholder="닉네임" value={nickname} onChange={(event) => setNickname(event.target.value)} autoFocus />
            <button disabled={!nickname.trim()}>입장하기</button>
          </form>
        </section>
      </main>
    )
  }

  return (
    <main className="chat-shell">
      <section className="chat-card">
        <header className="chat-header">
          <div>
            <span className="brand-small">Chatwar</span>
            <h1>{room.name}</h1>
          </div>
          <button className="copy-button" onClick={copyLink}>{copied ? '복사됨' : '초대 링크'}</button>
        </header>
        <div className="retention-note">최근 메시지 100개가 보관됩니다</div>
        <div className="message-list" aria-live="polite">
          {messages.length === 0 && <div className="empty-chat">첫 메시지를 남겨보세요.</div>}
          {messages.map((message) => {
            const mine = message.uid === user.uid
            return (
              <article className={`message-row ${mine ? 'mine' : ''}`} key={message.id}>
                {!mine && <span className="message-name">{message.nickname}</span>}
                <div className="message-line">
                  {message.type === 'emoji' ? (
                    <div className="message-emoji">
                      <img src={`/emojis/${message.emojiId}.png`} alt={`게임 이모티콘 ${message.emojiId}`} />
                    </div>
                  ) : (
                    <p className="message-bubble">{renderMessageText(message.text)}</p>
                  )}
                  <time>{formatTime(message.createdAt)}</time>
                </div>
              </article>
            )
          })}
          <div ref={bottomRef} />
        </div>
        <div className="composer-wrap">
          {emojiPickerOpen && (
            <div className="emoji-picker" role="dialog" aria-label="게임 이모티콘 선택">
              <div className="emoji-picker-title">게임 이모티콘</div>
              <div className="emoji-grid">
                {EMOJI_IDS.map((emojiId) => (
                  <button
                    type="button"
                    className="emoji-option"
                    key={emojiId}
                    onClick={() => insertEmojiToken(emojiId)}
                    aria-label={`${emojiToken(emojiId)} 입력`}
                    title={emojiToken(emojiId)}
                  >
                    <img src={`/emojis/${emojiId}.png`} alt="" loading="lazy" />
                    <span>{emojiToken(emojiId)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <form className="composer" onSubmit={sendMessage}>
            <button
              type="button"
              className={`emoji-toggle ${emojiPickerOpen ? 'active' : ''}`}
              aria-label="게임 이모티콘 열기"
              aria-expanded={emojiPickerOpen}
              onClick={() => setEmojiPickerOpen((open) => !open)}
            >
              ☺
            </button>
            <input
              ref={messageInputRef}
              maxLength="500"
              placeholder="메시지 또는 [하하]"
              value={text}
              onChange={(event) => setText(event.target.value)}
              aria-label="메시지"
            />
            <button className="send-button" disabled={!text.trim() || sending} aria-label="전송">전송</button>
          </form>
        </div>
      </section>
    </main>
  )
}

function StatusPage({ title, description, action = false }) {
  return (
    <main className="landing-shell">
      <section className="status-card">
        <span className="brand-mark">CW</span>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
        {action && <a href="/">새 방 만들기</a>}
      </section>
    </main>
  )
}
