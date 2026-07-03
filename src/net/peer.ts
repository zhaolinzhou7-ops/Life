import Peer, { type DataConnection } from 'peerjs';

/**
 * 基于 PeerJS 公共信令服务器的点对点连接。
 * 完全在浏览器里跑，不需要自建后端，因此可以直接部署到 GitHub Pages 这类纯静态托管。
 */
export interface NetConn {
  send(msg: unknown): void;
  onMessage(cb: (msg: any) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

// 公共信令服务器上所有 PeerJS 应用共用一个 ID 命名空间，加长前缀可以显著降低撞号概率。
const PREFIX = 'td-expedition-v1-';
// 去掉了容易看错的 0/O/1/I 等字符，方便口头/手动传房间码。
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(n = 4): string {
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

function wrap(conn: DataConnection, ownedPeer: Peer): NetConn {
  return {
    send: (msg) => {
      try {
        conn.send(msg);
      } catch {
        /* 连接已断时静默忽略 */
      }
    },
    onMessage: (cb) => conn.on('data', (d) => cb(d)),
    onClose: (cb) => {
      conn.on('close', cb);
      conn.on('error', cb);
    },
    close: () => {
      try {
        conn.close();
      } catch {
        /* ignore */
      }
      ownedPeer.destroy();
    },
  };
}

export interface Room {
  code: string;
  /** 等待对手加入；resolve 出可用连接。 */
  waitForGuest: () => Promise<NetConn>;
  cancel: () => void;
}

/** 房主：创建一个带 4 位房间码的房间。 */
export function createRoom(): Promise<Room> {
  return new Promise((resolve, reject) => {
    const attempt = (triesLeft: number) => {
      const code = randomCode();
      const peer = new Peer(PREFIX + code, { debug: 0 });
      let opened = false;

      peer.on('open', () => {
        opened = true;
        resolve({
          code,
          cancel: () => peer.destroy(),
          waitForGuest: () =>
            new Promise<NetConn>((res) => {
              peer.on('connection', (conn: DataConnection) => {
                conn.on('open', () => res(wrap(conn, peer)));
              });
            }),
        });
      });

      peer.on('error', (err: any) => {
        if (opened) return;
        // 房间码被占用则换一个重试
        if (err?.type === 'unavailable-id' && triesLeft > 0) {
          peer.destroy();
          attempt(triesLeft - 1);
        } else {
          peer.destroy();
          reject(err);
        }
      });
    };
    attempt(6);
  });
}

/** 访客：用房间码加入房主。 */
export function joinRoom(code: string): Promise<NetConn> {
  return new Promise((resolve, reject) => {
    const peer = new Peer({ debug: 0 });
    let settled = false;
    const fail = (e: unknown) => {
      if (settled) return;
      settled = true;
      peer.destroy();
      reject(e instanceof Error ? e : new Error(String(e)));
    };

    peer.on('open', () => {
      const conn = peer.connect(PREFIX + code.toUpperCase(), { reliable: true });
      conn.on('open', () => {
        if (settled) return;
        settled = true;
        resolve(wrap(conn, peer));
      });
      conn.on('error', fail);
      // 房间码不存在时，PeerJS 不会立即报错，靠超时兜底
      setTimeout(() => fail(new Error('连接超时：请确认房间码正确、房主仍在等待')), 15000);
    });

    peer.on('error', (err: any) => {
      // 找不到对端时的典型错误
      if (err?.type === 'peer-unavailable') fail(new Error('房间不存在或房主已离开'));
      else fail(err);
    });
  });
}
