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
import { getInitialLanguage, LANGUAGE_OPTIONS, normalizeLanguage, translateMessage } from './translation'

const NICKNAME_KEY = 'chatwar.nickname'
const PRESENCE_INTERVAL = 60_000
const ONLINE_THRESHOLD = 150_000
const MESSAGE_MAX_LENGTH = 500
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

function isEmojiOnlyMessage(messageText) {
  let emojiCount = 0
  const remainingText = messageText.replace(/\[[^\]\n]{1,20}\]/g, (token) => {
    if (!EMOJI_BY_TOKEN[token]) return token
    emojiCount += 1
    return ''
  })
  return emojiCount > 0 && remainingText.trim() === ''
}

function renderMessageText(messageText, largeEmoji = false) {
  const content = []

  messageText.split(/(\[[^\]\n]{1,20}\])/g).forEach((part, index) => {
    const emojiId = EMOJI_BY_TOKEN[part]
    if (emojiId) {
      content.push(
        <img
          className={`inline-emoji ${largeEmoji ? 'standalone' : ''}`}
          src={`/emojis/${emojiId}.png`}
          alt={part}
          title={part}
          key={`emoji-${index}`}
        />,
      )
      return
    }

    part.split('\n').forEach((line, lineIndex) => {
      if (lineIndex > 0) content.push(<br key={`break-${index}-${lineIndex}`} />)
      if (line) content.push(line)
    })
  })

  return content
}

function TranslatedText({ message, targetLanguage }) {
  const sourceLanguage = normalizeLanguage(message.sourceLanguage || 'ko')
  const needsTranslation = sourceLanguage !== targetLanguage
  const [translatedText, setTranslatedText] = useState(message.text)
  const [showOriginal, setShowOriginal] = useState(false)

  useEffect(() => {
    let active = true
    if (!needsTranslation) return () => { active = false }
    translateMessage(message.text, sourceLanguage, targetLanguage)
      .then((translated) => { if (active) setTranslatedText(translated) })
      .catch(() => {})
    return () => { active = false }
  }, [message.text, needsTranslation, sourceLanguage, targetLanguage])

  const visibleText = showOriginal ? message.text : translatedText
  const emojiOnly = isEmojiOnlyMessage(visibleText)
  return (
    <div className="translated-content">
      <span className={emojiOnly ? 'emoji-only-content' : ''}>{renderMessageText(visibleText, emojiOnly)}</span>
      {needsTranslation && translatedText !== message.text && (
        <button className="translation-toggle" onClick={() => setShowOriginal((show) => !show)}>
          {showOriginal ? '번역 보기' : '원문 보기'}
        </button>
      )}
    </div>
  )
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
        participants: {},
        mutedUsers: [],
        kickedUsers: [],
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
  const [participantPanelOpen, setParticipantPanelOpen] = useState(false)
  const [systemText, setSystemText] = useState('')
  const [presenceNow, setPresenceNow] = useState(0)
  const [joinError, setJoinError] = useState('')
  const [displayLanguage, setDisplayLanguage] = useState(getInitialLanguage)
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
      const nextRoom = { id: snapshot.id, ...snapshot.data() }
      setRoom(nextRoom)
      setMessages(nextRoom.messages ?? [])
    })
  }, [joined, roomId, roomState])

  useEffect(() => {
    if (!joined || roomState !== 'ready') return undefined

    const updatePresence = async () => {
      const roomReference = doc(db, 'rooms', roomId)
      await runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(roomReference)
        if (!snapshot.exists()) return
        const data = snapshot.data()
        if ((data.kickedUsers ?? []).includes(user.uid)) return
        transaction.update(roomReference, {
          participants: {
            ...(data.participants ?? {}),
            [user.uid]: { uid: user.uid, nickname, lastSeen: Date.now() },
          },
        })
      }).catch(() => {})
      setPresenceNow(Date.now())
    }

    updatePresence()
    const heartbeat = window.setInterval(updatePresence, PRESENCE_INTERVAL)
    const clock = window.setInterval(() => setPresenceNow(Date.now()), 30_000)
    return () => {
      window.clearInterval(heartbeat)
      window.clearInterval(clock)
    }
  }, [joined, nickname, roomId, roomState, user.uid])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function enterRoom(event) {
    event.preventDefault()
    const nextNickname = nickname.trim()
    if (!nextNickname) return
    setJoinError('')

    try {
      const roomReference = doc(db, 'rooms', roomId)
      await runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(roomReference)
        if (!snapshot.exists()) throw new Error('Room not found')
        const data = snapshot.data()
        if ((data.kickedUsers ?? []).includes(user.uid)) throw new Error('Kicked')
        transaction.update(roomReference, {
          participants: {
            ...(data.participants ?? {}),
            [user.uid]: { uid: user.uid, nickname: nextNickname, lastSeen: Date.now() },
          },
        })
      })
      localStorage.setItem(NICKNAME_KEY, nextNickname)
      setNickname(nextNickname)
      setJoined(true)
    } catch (error) {
      setJoinError(error.message === 'Kicked' ? '이 방에서 강퇴되었습니다.' : '방에 입장하지 못했습니다.')
    }
  }

  async function appendMessage({ type, messageText = '', emojiId = null }) {
    if (sending || (room?.mutedUsers ?? []).includes(user.uid)) return false
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
          sourceLanguage: displayLanguage,
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
    requestAnimationFrame(() => {
      if (messageInputRef.current) messageInputRef.current.style.height = 'auto'
    })
  }

  function insertEmojiToken(emojiId) {
    const input = messageInputRef.current
    const token = emojiToken(emojiId)
    const start = input?.selectionStart ?? text.length
    const end = input?.selectionEnd ?? start
    const nextText = `${text.slice(0, start)}${token}${text.slice(end)}`
    setText(nextText.slice(0, MESSAGE_MAX_LENGTH))
    setEmojiPickerOpen(false)

    requestAnimationFrame(() => {
      const cursor = Math.min(start + token.length, MESSAGE_MAX_LENGTH)
      const input = messageInputRef.current
      input?.focus()
      input?.setSelectionRange(cursor, cursor)
      if (input) {
        input.style.height = 'auto'
        input.style.height = `${Math.min(input.scrollHeight, 120)}px`
      }
    })
  }

  function handleMessageKeyDown(event) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    if (!isMuted && text.trim() && !sending) event.currentTarget.form?.requestSubmit()
  }

  function resizeMessageInput(event) {
    event.currentTarget.style.height = 'auto'
    event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 120)}px`
  }

  async function moderateParticipant(targetUid, action) {
    if (room?.createdBy !== user.uid || targetUid === user.uid) return
    const roomReference = doc(db, 'rooms', roomId)
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(roomReference)
      if (!snapshot.exists()) return
      const data = snapshot.data()
      if (data.createdBy !== user.uid) return
      const mutedUsers = data.mutedUsers ?? []

      if (action === 'mute') {
        transaction.update(roomReference, {
          participants: data.participants ?? {},
          mutedUsers: mutedUsers.includes(targetUid)
            ? mutedUsers.filter((uid) => uid !== targetUid)
            : [...mutedUsers, targetUid],
          kickedUsers: data.kickedUsers ?? [],
        })
        return
      }

      if (action === 'kick') {
        const participants = { ...(data.participants ?? {}) }
        delete participants[targetUid]
        transaction.update(roomReference, {
          participants,
          mutedUsers: mutedUsers.filter((uid) => uid !== targetUid),
          kickedUsers: [...new Set([...(data.kickedUsers ?? []), targetUid])],
        })
      }
    })
  }

  async function sendSystemMessage(event) {
    event.preventDefault()
    const nextText = systemText.trim()
    if (!nextText || room?.createdBy !== user.uid) return
    setSystemText('')
    const sent = await appendMessage({ type: 'system', messageText: nextText })
    if (!sent) setSystemText(nextText)
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
          {joinError && <p className="error-text">{joinError}</p>}
        </section>
      </main>
    )
  }

  function changeDisplayLanguage(event) {
    const language = event.target.value
    localStorage.setItem('chatwar.language', language)
    setDisplayLanguage(language)
  }

  const participants = Object.values(room.participants ?? {})
    .filter((participant) => presenceNow - participant.lastSeen <= ONLINE_THRESHOLD)
    .sort((left, right) => Number(right.uid === room.createdBy) - Number(left.uid === room.createdBy))
  const isHost = room.createdBy === user.uid
  const isMuted = (room.mutedUsers ?? []).includes(user.uid)
  const isKicked = (room.kickedUsers ?? []).includes(user.uid)

  if (isKicked) {
    return <StatusPage title="강퇴되었습니다" description="방장이 이 채팅방에서 내보냈습니다." action />
  }

  return (
    <main className="chat-shell">
      <section className="chat-card">
        <header className="chat-header">
          <div>
            <span className="brand-small">Chatwar</span>
            <h1>{room.name}</h1>
          </div>
          <div className="header-actions">
            <select className="language-select" value={displayLanguage} onChange={changeDisplayLanguage} aria-label="표시 언어">
              {LANGUAGE_OPTIONS.map((language) => (
                <option value={language.code} key={language.code}>{language.label}</option>
              ))}
            </select>
            <button className="participants-button" onClick={() => setParticipantPanelOpen((open) => !open)}>
              접속자 {participants.length}
            </button>
            <button className="copy-button" onClick={copyLink}>{copied ? '복사됨' : '초대 링크'}</button>
          </div>
        </header>
        {participantPanelOpen && (
          <aside className="participant-panel">
            <div className="participant-panel-header">
              <strong>접속자 {participants.length}</strong>
              <button onClick={() => setParticipantPanelOpen(false)} aria-label="접속자 목록 닫기">×</button>
            </div>
            <div className="participant-list">
              {participants.map((participant) => {
                const participantIsHost = participant.uid === room.createdBy
                const participantIsMuted = (room.mutedUsers ?? []).includes(participant.uid)
                return (
                  <div className="participant-row" key={participant.uid}>
                    <div className="participant-name">
                      <span className="online-dot" />
                      <span>{participant.nickname}</span>
                      {participantIsHost && <em>방장</em>}
                      {participantIsMuted && <em className="muted-label">채팅 금지</em>}
                    </div>
                    {isHost && !participantIsHost && (
                      <div className="participant-controls">
                        <button onClick={() => moderateParticipant(participant.uid, 'mute')}>
                          {participantIsMuted ? '금지 해제' : '채팅 금지'}
                        </button>
                        <button className="kick-button" onClick={() => moderateParticipant(participant.uid, 'kick')}>강퇴</button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            {isHost && (
              <form className="system-message-form" onSubmit={sendSystemMessage}>
                <input maxLength="500" value={systemText} onChange={(event) => setSystemText(event.target.value)} placeholder="시스템 메시지" />
                <button disabled={!systemText.trim() || sending}>보내기</button>
              </form>
            )}
          </aside>
        )}
        <div className="retention-note">최근 메시지 100개가 보관됩니다</div>
        <div className="message-list" aria-live="polite">
          {messages.length === 0 && <div className="empty-chat">첫 메시지를 남겨보세요.</div>}
          {messages.map((message) => {
            if (message.type === 'system') {
              return <div className="system-message" key={message.id}><TranslatedText key={`${message.id}-${displayLanguage}`} message={message} targetLanguage={displayLanguage} /></div>
            }
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
                    <div className={`message-bubble ${isEmojiOnlyMessage(message.text) ? 'emoji-only' : ''}`}>
                      <TranslatedText key={`${message.id}-${displayLanguage}`} message={message} targetLanguage={displayLanguage} />
                    </div>
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
              disabled={isMuted}
            >
              ☺
            </button>
            <div className="message-input-wrap">
              <textarea
                ref={messageInputRef}
                rows="1"
                maxLength={MESSAGE_MAX_LENGTH}
                placeholder={isMuted ? '방장이 채팅을 금지했습니다' : '메시지 또는 [하하]'}
                value={text}
                onChange={(event) => setText(event.target.value)}
                onInput={resizeMessageInput}
                onKeyDown={handleMessageKeyDown}
                aria-label="메시지"
                disabled={isMuted}
              />
              <span className="character-counter">{text.length}/{MESSAGE_MAX_LENGTH}</span>
            </div>
            <button className="send-button" disabled={isMuted || !text.trim() || sending} aria-label="전송">전송</button>
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
