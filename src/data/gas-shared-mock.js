/**
 * ของปลอมของ Google สำหรับเทสต์ส่วน "ข้อมูลกลาง" ของ tx-api.gs กับ cut-api.gs
 * Script Properties, ไฟล์ใน Drive และตัวตั้งเวลา เก็บไว้ในตัวแปรให้เทสต์เปิดดูได้
 * ไม่ใช่ไฟล์เทสต์ (ไม่ลงท้าย .test.js) vitest จึงไม่รันตรง ๆ
 */
export function sharedMocks({ props = {}, folder = true } = {}) {
  const store = {};
  Object.keys(props).forEach((k) => { store[k] = typeof props[k] === 'string' ? props[k] : JSON.stringify(props[k]); });
  const files = {};
  const folders = [];
  const triggers = [];
  let next = 1;

  const fileApi = (id) => ({
    getId: () => id,
    isTrashed: () => files[id].trashed,
    setContent: (text) => { files[id].content = text; files[id].writes++; },
    getBlob: () => ({ getDataAsString: () => files[id].content }),
  });
  const makeFolder = (name) => {
    const f = {
      name,
      createFile: (fileName, content, mime) => {
        const id = `file${next++}`;
        files[id] = { name: fileName, content, mime, folder: name, trashed: false, writes: 1 };
        return fileApi(id);
      },
    };
    folders.push(f);
    return f;
  };
  if (folder) makeFolder('WMS ข้อมูลกลาง');

  const env = {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in store ? store[k] : null),
        setProperty: (k, v) => { store[k] = String(v); },
        deleteProperty: (k) => { delete store[k]; },
        getProperties: () => ({ ...store }),
      }),
    },
    DriveApp: {
      getFileById: (id) => {
        if (!files[id]) throw new Error('ไม่พบไฟล์');
        return fileApi(id);
      },
      getFoldersByName: (name) => {
        const list = folders.filter((f) => f.name === name);
        let i = 0;
        return { hasNext: () => i < list.length, next: () => list[i++] };
      },
      createFolder: (name) => makeFolder(name),
    },
    ScriptApp: {
      getProjectTriggers: () => triggers.map((t) => ({ getHandlerFunction: () => t.fn, t })),
      deleteTrigger: (x) => { triggers.splice(triggers.indexOf(x.t), 1); },
      newTrigger: (fn) => {
        const t = { fn };
        const create = () => ({ create: () => { triggers.push(t); } });
        return {
          timeBased: () => ({
            everyMinutes: (m) => { t.minutes = m; return create(); },
            everyHours: (h) => { t.hours = h; return create(); },
            everyDays: (d) => { t.days = d; return { atHour: (h) => { t.atHour = h; return create(); } }; },
          }),
        };
      },
    },
  };

  const info = (name) => (store[`shared:${name}`] ? JSON.parse(store[`shared:${name}`]) : null);
  return {
    env,
    store,
    files,
    folders,
    triggers,
    /** ป้ายของชุดที่เก็บไว้ใน Script Properties */
    info,
    /** เนื้อไฟล์ของชุดที่เก็บไว้ */
    content: (name) => JSON.parse(files[info(name).file].content),
    /** ใส่ป้ายว่ามีคนกำลังคิดอยู่ เริ่มเมื่อ ago มิลลิวินาทีก่อน */
    running: (name, ago, by = 'คนอื่น') => { store[`shared-run:${name}`] = JSON.stringify({ at: Date.now() - ago, by, auto: false }); },
  };
}
