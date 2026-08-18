export const meta = {
  name: 'hard-qa',
  description: 'Opus QA agents attack the build along four dimensions, Sonnet fixers repair what they find, Opus verifiers confirm; loops until QA runs out of complaints',
  whenToUse: 'After hard-build converges — unit, e2e, stress and edge-case QA with a fix-and-verify loop',
  phases: [
    { title: 'QA', detail: 'Opus QA agents probe the build, each along its own dimension', model: 'opus' },
    { title: 'Fix', detail: 'Sonnet fixers apply prescribed fixes, one agent per file', model: 'sonnet' },
    { title: 'Verify', detail: 'Opus verifiers confirm each fix or re-open the finding', model: 'opus' },
  ],
}

// args должен приходить объектом, но передать его JSON-строкой легко, и тогда
// spread рассыпал бы строку по символам, а воркфлоу молча ушёл бы работать с
// настройками по умолчанию — то есть запустил бы полный прогон вместо заказанного.
function inputArgs() {
  if (typeof args !== 'string') return args || {}
  try {
    return JSON.parse(args)
  } catch (error) {
    throw new Error(`args пришли строкой и не разбираются как JSON: ${error.message}`)
  }
}

const cfg = {
  target: 'Реализованная функциональность',
  specPath: '',
  testCommand: 'npm test',
  maxRounds: 3,
  maxFixFilesPerRound: 6,
  qaEffort: 'high',
  fixEffort: 'high',
  verifyEffort: 'high',
  reserveTokens: 80_000,
  dimensions: ['unit', 'e2e', 'stress', 'edge'],
  ...inputArgs(),
}

// Каждое измерение пишет тесты только в свой файл-namespace: иначе два QA-агента
// параллельно перезапишут один и тот же тестовый файл.
const BRIEFS = {
  unit: {
    title: 'юнит-тесты',
    brief: `Чистые функции и их границы. Ищи логику, у которой нет теста вообще, и тесты, которые проходят, ничего не проверяя (assert на моке, ожидание, повторяющее реализацию). Проверь, что тесты падают, если сломать логику: испорти строку в реализации, убедись, что тест краснеет, верни как было.`,
    tests: 'tests/qa-unit-*.test.ts',
  },
  e2e: {
    title: 'сквозные пути',
    brief: `Полный путь данных от входа до результата, на реальных вызовах, а не на моках всего подряд. Ищи разрывы между слоями: контракт, который на бумаге сходится, а на деле отдаёт другую форму; состояние, которое не доживает до следующего шага; ошибку, которая теряется по дороге и превращается в тишину.`,
    tests: 'tests/qa-e2e-*.test.ts',
  },
  stress: {
    title: 'нагрузка и параллелизм',
    brief: `Что будет при повторах, гонках и обрывах. Два одновременных запроса на одну сущность; повторный вызов после таймаута; процесс, умерший на середине операции; внешний сервис, отвечающий 5xx и 429. Ищи двойные записи, потерянные задачи, состояния, из которых нет выхода.`,
    tests: 'tests/qa-stress-*.test.ts',
  },
  edge: {
    title: 'краевые случаи',
    brief: `Пустое, нулевое, отрицательное, гигантское, чужой алфавит, эмодзи, кавычки и апострофы, обрезанный UTF-8, дата на границе суток и часового пояса, число на границе лимита. Ищи вход, который приведёт к падению, порче данных или молчаливо неверному результату.`,
    tests: 'tests/qa-edge-*.test.ts',
  },
}

const QA_SCHEMA = {
  type: 'object',
  required: ['clean', 'findings'],
  properties: {
    clean: { type: 'boolean' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'file', 'summary', 'repro', 'fix'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          file: { type: 'string' },
          line: { type: 'number' },
          summary: { type: 'string' },
          repro: { type: 'string' },
          fix: { type: 'string' },
        },
      },
    },
    testsAdded: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
}

const FIX_SCHEMA = {
  type: 'object',
  required: ['summary', 'testsPassed'],
  properties: {
    summary: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    testsPassed: { type: 'boolean' },
    testOutputTail: { type: 'string' },
    refused: {
      type: 'array',
      items: {
        type: 'object',
        required: ['summary', 'why'],
        properties: { summary: { type: 'string' }, why: { type: 'string' } },
      },
    },
  },
}

const VERIFY_SCHEMA = {
  type: 'object',
  required: ['testsPassed', 'verdicts'],
  properties: {
    testsPassed: { type: 'boolean' },
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['summary', 'fixed', 'evidence'],
        properties: {
          summary: { type: 'string' },
          fixed: { type: 'boolean' },
          evidence: { type: 'string' },
        },
      },
    },
  },
}

function qaPrompt(dim, round, known) {
  const d = BRIEFS[dim] || { title: dim, brief: `Проверь ${dim}.`, tests: `tests/qa-${dim}-*.test.ts` }
  const seen = known.length
    ? `\n\nУЖЕ НАЙДЕНО РАНЬШЕ (не повторяй, ищи новое):\n${known.map((k) => `- ${k}`).join('\n')}`
    : ''
  return `Раунд ${round}. Ты QA-инженер, измерение — ${d.title}. Цель проверки: ${cfg.target}
${cfg.specPath ? `Спека: ${cfg.specPath} — требования берутся из неё, а не из кода. Расхождение кода со спекой само по себе дефект.` : ''}

${d.brief}${seen}

КАК РАБОТАТЬ:
- Тесты пишешь только в файлы вида ${d.tests} — чужие тестовые файлы не трогаешь.
- Продакшн-код НЕ правишь: твоя работа — найти и доказать. Правкой займётся другой агент.
- Запускай ${cfg.testCommand}. Каждая находка должна быть доказана: команда, вход, наблюдаемый неверный результат.
- Не выдумывай дефекты ради отчёта. Пустой список — нормальный результат, если ты действительно искал.
- fix — конкретная инструкция для исполнителя: что и где изменить. Не «улучшить обработку ошибок», а какое поведение должно быть вместо какого.

clean: true, только если по твоему измерению претензий нет.`
}

function fixPrompt(file, findings, round) {
  return `Раунд ${round}. Ты исполнитель правок. Файл: ${file}

QA нашёл здесь ${findings.length} дефект(ов). По каждому — воспроизведение и предписанная правка:

${findings.map((f, i) => `${i + 1}. [${f.severity}] ${f.summary}\n   Воспроизведение: ${f.repro}\n   Что сделать: ${f.fix}`).join('\n\n')}

ПРАВИЛА:
- Меняешь только ${file} (плюс, если нужно, свой новый тест на этот дефект).
- Сначала тест, который краснеет на дефекте, потом правка, потом ${cfg.testCommand} целиком.
- Комментарии — только там, где объясняют неочевидное решение, на русском, в стиле окружающего кода.
- Заглушки и «пока вернём null» запрещены.
- Если находка ошибочна (дефекта нет, QA неправ) — не правь код ради вида: положи её в refused с обоснованием. Это допустимый и ожидаемый исход.
- Не коммить и не пушь.`
}

function verifyPrompt(file, findings, fix, round) {
  return `Раунд ${round}. Ты верификатор, независимый от исполнителя. Файл: ${file}

Проверяешь, действительно ли устранены эти дефекты:
${findings.map((f, i) => `${i + 1}. ${f.summary}\n   Воспроизведение: ${f.repro}`).join('\n\n')}

Отчёт исполнителя: ${JSON.stringify(fix)}

Не верь отчёту. Воспроизведи каждый дефект сам по описанию и запусти ${cfg.testCommand}.

По каждому дефекту: fixed=true только при доказательстве, что прежнее воспроизведение больше не даёт неверного результата. Отдельно смотри, не сломала ли правка соседнее поведение и не «исправлен» ли дефект удалением проверки или ослаблением теста — такое считается НЕ исправленным.

evidence — что именно ты запустил и что увидел.`
}

const key = (f) => `${f.file}::${(f.summary || '').toLowerCase().slice(0, 80)}`

const seen = new Set()
const fixed = []
const open = []
const refused = []
const testsAdded = []
let round = 0
let quietRounds = 0
let closedBy = 'maxRounds'
// Чистым результат считается только если последний раунд покрыл все измерения:
// три отчёта из четырёх — это «по трём измерениям претензий нет», не «чисто».
let coveredAllDimensions = false

while (round < cfg.maxRounds) {
  if (budget.total && budget.remaining() < cfg.reserveTokens) {
    closedBy = 'budget'
    log(`Остаток бюджета ${Math.round(budget.remaining() / 1000)}k — новый раунд QA не начинаю`)
    break
  }

  round += 1
  phase('QA')

  // Барьер здесь оправдан: находки всех измерений нужны вместе, чтобы
  // сгруппировать правки по файлам и не посадить двух исполнителей на один файл.
  const reports = await parallel(
    cfg.dimensions.map((dim) => () =>
      agent(qaPrompt(dim, round, [...seen]), {
        label: `qa:${dim}`,
        phase: 'QA',
        model: 'opus',
        effort: cfg.qaEffort,
        schema: QA_SCHEMA,
      }).then((r) => (r ? { dim, ...r } : null))
    )
  )

  const alive = reports.filter(Boolean)
  const lost = cfg.dimensions.length - alive.length
  if (lost > 0) log(`Раунд ${round}: ${lost} QA-агент(ов) не вернули отчёт — их измерения в этом раунде не покрыты`)

  // Ноль отчётов — это не «претензий нет», а несостоявшаяся проверка. Без этой
  // ветки упавшие агенты давали бы clean: true, то есть ровно ту ложную зелёную
  // галочку, ради которой вся механика и строится.
  if (!alive.length) {
    closedBy = 'qa-lost'
    log(`Раунд ${round}: ни один QA-агент не вернул отчёт — проверка не состоялась`)
    break
  }
  coveredAllDimensions = lost === 0

  for (const r of alive) testsAdded.push(...(r.testsAdded || []))

  const fresh = alive
    .flatMap((r) => (r.findings || []).map((f) => ({ ...f, dimension: r.dim })))
    .filter((f) => !seen.has(key(f)))

  if (!fresh.length) {
    quietRounds += 1
    log(`Раунд ${round}: новых дефектов нет (тихих раундов подряд: ${quietRounds})`)
    if (quietRounds >= 2 || round === 1) {
      closedBy = 'clean'
      break
    }
    continue
  }

  quietRounds = 0
  for (const f of fresh) seen.add(key(f))
  log(`Раунд ${round}: новых дефектов ${fresh.length} — блокеров ${fresh.filter((f) => f.severity === 'blocker').length}`)

  // Группируем по файлу: внутри файла правки последовательны (один агент на все
  // его дефекты), между файлами — параллельно.
  const byFile = new Map()
  for (const f of fresh) {
    const list = byFile.get(f.file) || []
    list.push(f)
    byFile.set(f.file, list)
  }
  let files = [...byFile.keys()]
  if (files.length > cfg.maxFixFilesPerRound) {
    const dropped = files.slice(cfg.maxFixFilesPerRound)
    log(`Раунд ${round}: файлов с дефектами ${files.length}, беру ${cfg.maxFixFilesPerRound} — остальные (${dropped.join(', ')}) вернутся следующим раундом`)
    for (const f of dropped) for (const finding of byFile.get(f)) seen.delete(key(finding))
    files = files.slice(0, cfg.maxFixFilesPerRound)
  }

  // Правка и проверка — цепочкой по каждому файлу: верификатор стартует сразу,
  // как закончил его исполнитель, не дожидаясь остальных файлов.
  const results = await pipeline(
    files,
    (file) =>
      agent(fixPrompt(file, byFile.get(file), round), {
        label: `fix:${file}`,
        phase: 'Fix',
        model: 'sonnet',
        effort: cfg.fixEffort,
        schema: FIX_SCHEMA,
      }),
    (fix, file) =>
      fix
        ? agent(verifyPrompt(file, byFile.get(file), fix, round), {
            label: `verify:${file}`,
            phase: 'Verify',
            model: 'opus',
            effort: cfg.verifyEffort,
            schema: VERIFY_SCHEMA,
          }).then((v) => ({ file, fix, verify: v }))
        : { file, fix: null, verify: null }
  )

  for (const r of results.filter(Boolean)) {
    const findings = byFile.get(r.file) || []
    refused.push(...((r.fix && r.fix.refused) || []).map((x) => ({ file: r.file, ...x })))

    if (!r.verify) {
      // Без проверки правку нельзя считать сделанной: возвращаем дефекты в поиск.
      for (const f of findings) {
        seen.delete(key(f))
        open.push({ ...f, round, reason: 'проверка не состоялась' })
      }
      continue
    }

    for (const f of findings) {
      const verdict = (r.verify.verdicts || []).find((v) => (v.summary || '').toLowerCase().slice(0, 40) === (f.summary || '').toLowerCase().slice(0, 40))
      if (verdict && verdict.fixed) fixed.push({ ...f, round, evidence: verdict.evidence })
      else open.push({ ...f, round, reason: verdict ? verdict.evidence : 'верификатор не дал приговор по этому дефекту' })
    }
  }
}

const stillOpen = open.filter((o) => !fixed.some((f) => key(f) === key(o)))

return {
  rounds: round,
  closedBy,
  coveredAllDimensions,
  clean: stillOpen.length === 0 && closedBy === 'clean' && coveredAllDimensions,
  fixed,
  open: stillOpen,
  refused,
  testsAdded,
}
