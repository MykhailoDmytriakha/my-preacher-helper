import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';

import DashboardPage from '@/(pages)/(private)/dashboard/page';

const mockUseAuth = jest.fn();
const mockUseDashboardSermons = jest.fn();
const mockUseSeries = jest.fn();
const mockUseStudyNotes = jest.fn();
const mockUsePrayerRequests = jest.fn();
const mockUseGroups = jest.fn();
const mockCreatePrayer = jest.fn();
const mockCreateSermon = jest.fn();
const mockRouterPush = jest.fn();

const mockTranslationMap: Record<string, string> = {
  'navigation.sermons': 'Проповеди',
  'navigation.studies': 'Изучения',
  'navigation.groups': 'Группы',
  'navigation.prayer': 'Молитва',
  'dashboardHome.title': 'Панель',
  'dashboardHome.subtitle': 'Сегодняшняя работа служения',
  'dashboardHome.actions.newSermon': 'Новая проповедь',
  'dashboardHome.actions.addStudyNote': 'Добавить заметку',
  'dashboardHome.actions.addPrayer': 'Добавить молитву',
  'dashboardHome.metrics.label': 'Метрики панели',
  'dashboardHome.metrics.activeSermons.label': 'Активные проповеди',
  'dashboardHome.metrics.activeSermons.helper': 'В подготовке',
  'dashboardHome.metrics.activeSeries.label': 'Активные серии',
  'dashboardHome.metrics.activeSeries.helper': 'Текущие серии',
  'dashboardHome.metrics.studyNotes.label': 'Заметки',
  'dashboardHome.metrics.studyNotes.helper': 'Заметки и вопросы',
  'dashboardHome.metrics.upcomingDates.label': 'Ближайшие даты',
  'dashboardHome.metrics.upcomingDates.helper': 'Следующие 14 дней',
  'dashboardHome.metrics.activePrayers.label': 'Активные молитвы',
  'dashboardHome.metrics.activePrayers.helper': 'Требуют внимания',
  'dashboardHome.time.unknown': 'Нет даты',
  'dashboardHome.time.today': 'Сегодня',
  'dashboardHome.time.yesterday': 'Вчера',
  'dashboardHome.time.allDay': 'Весь день',
  'dashboardHome.time.daysAgo': '{{count}} дн. назад',
  'dashboardHome.sections.sermons.title': 'Проповеди',
  'dashboardHome.sections.sermons.viewAll': 'Все проповеди',
  'dashboardHome.sections.sermons.empty': 'Пока нет проповедей.',
  'dashboardHome.sections.sermons.untitled': 'Проповедь без названия',
  'dashboardHome.sections.sermons.noVerse': 'Текст Писания не указан',
  'dashboardHome.sections.sermons.status.preparing': 'Готовится',
  'dashboardHome.sections.sermons.status.preached': 'Проповедана',
  'dashboardHome.sections.sermons.preachedAt': 'Проповедана {{date}}',
  'dashboardHome.sections.sermons.plannedFor': 'Запланирована на {{date}}',
  'dashboardHome.sections.sermons.updatedAt': 'Обновлена {{date}}',
  'dashboardHome.sections.week.title': 'Эта неделя',
  'dashboardHome.sections.week.viewCalendar': 'Открыть календарь',
  'dashboardHome.sections.week.viewFullCalendar': 'Весь календарь',
  'dashboardHome.sections.week.empty': 'Нет ближайших или недавних прошедших проповедей и групп.',
  'dashboardHome.sections.week.types.sermon': 'Проповедь',
  'dashboardHome.sections.week.types.group': 'Группа',
  'dashboardHome.sections.prayer.title': 'Молитвенный фокус',
  'dashboardHome.sections.prayer.addPrayer': 'Добавить молитву',
  'dashboardHome.sections.prayer.addUpdate': 'Добавить обновление',
  'dashboardHome.sections.prayer.viewAll': 'Все молитвы',
  'dashboardHome.sections.prayer.empty': 'Пока нет молитвенных нужд.',
  'dashboardHome.sections.prayer.noUpdates': 'Обновлений пока нет.',
  'dashboardHome.sections.prayer.status.active': 'Активна',
  'dashboardHome.sections.prayer.status.answered': 'Отвечена',
  'dashboardHome.sections.prayer.status.not_answered': 'Без ответа',
  'dashboardHome.sections.series.title': 'Активные серии',
  'dashboardHome.sections.series.viewAll': 'Все серии',
  'dashboardHome.sections.series.empty': 'Пока нет серий проповедей.',
  'dashboardHome.sections.series.untitled': 'Серия без названия',
  'dashboardHome.sections.series.progress': '{{preached}} из {{total}} проповедано',
  'dashboardHome.sections.series.noItems': 'Нет материалов',
  'dashboardHome.sections.series.next': 'Далее: {{title}}',
  'dashboardHome.sections.series.noNext': 'Серия завершена или следующего материала нет',
  'dashboardHome.sections.series.status.draft': 'Черновик',
  'dashboardHome.sections.series.status.active': 'Активна',
  'dashboardHome.sections.series.status.completed': 'Завершена',
  'dashboardHome.sections.studies.title': 'Последние заметки',
  'dashboardHome.sections.studies.viewAll': 'Все изучения',
  'dashboardHome.sections.studies.empty': 'Пока нет заметок для изучения.',
  'dashboardHome.sections.studies.untitled': 'Заметка без названия',
  'dashboardHome.sections.studies.noteTag': 'Заметка',
  'dashboardHome.sections.studies.questionTag': 'Вопрос',
  'dashboardHome.sections.studies.table.study': 'Изучение',
  'dashboardHome.sections.studies.table.tags': 'Теги',
  'dashboardHome.sections.studies.table.notes': 'Заметки',
  'dashboardHome.sections.studies.table.questions': 'Вопросы',
  'dashboardHome.sections.groups.title': 'Последние группы',
  'dashboardHome.sections.groups.viewAll': 'Все группы',
  'dashboardHome.sections.groups.empty': 'Пока нет групп.',
  'dashboardHome.sections.groups.progress': 'Ход встречи готов на {{percent}}%',
  'dashboardHome.sections.groups.nextMeeting': 'Следующая: {{date}}',
  'dashboardHome.sections.groups.noMeeting': 'Дата встречи не задана',
  'dashboardHome.sections.groups.status.active': 'Активна',
  'dashboardHome.sections.groups.status.completed': 'Завершена',
  'dashboardHome.sections.attention.title': 'Требует внимания',
  'dashboardHome.sections.attention.empty': 'Сейчас нет задач, требующих внимания.',
  'dashboardHome.sections.attention.viewAll': 'Показать все ({{count}})',
  'dashboardHome.sections.attention.table.item': 'Элемент',
  'dashboardHome.sections.attention.table.category': 'Категория',
  'dashboardHome.sections.attention.table.severity': 'Важность',
  'dashboardHome.sections.attention.table.due': 'Срок / возраст',
  'dashboardHome.sections.attention.table.notes': 'Заметки',
  'dashboardHome.sections.attention.table.action': 'Действие',
  'dashboardHome.sections.attention.severity.low': 'Низкая',
  'dashboardHome.sections.attention.severity.medium': 'Средняя',
  'dashboardHome.sections.attention.severity.high': 'Высокая',
  'dashboardHome.sections.attention.items.unscheduledSermon': 'Черновик проповеди без даты — «{{title}}»',
  'dashboardHome.sections.attention.items.studyQuestion': 'Вопрос изучения требует ответа — {{title}}',
  'dashboardHome.sections.attention.items.draftStudy': 'Черновик заметки не проверен — {{title}}',
  'dashboardHome.sections.attention.items.stalePrayer': 'Молитвенная нужда давно без обновления — {{title}}',
  'dashboardHome.sections.attention.items.incompleteGroup': 'План группы не завершён — {{title}}',
  'dashboardHome.sections.attention.notes.outlineStarted': 'Подготовка начата',
  'dashboardHome.sections.attention.notes.questionsNeedAnswers': 'Нужны ответы на вопросы',
  'dashboardHome.sections.attention.notes.readyForReview': 'Готово к проверке',
  'dashboardHome.sections.attention.notes.noUpdate': 'Нет недавнего обновления',
  'dashboardHome.sections.attention.notes.agendaRemaining': 'Остались пункты встречи',
  'dashboardHome.sections.attention.due.noDate': 'Нет даты',
  'dashboardHome.sections.attention.due.days': '{{count}} дней',
  'dashboardHome.sections.attention.actions.review': 'Проверить',
  'dashboardHome.sections.attention.actions.openStudy': 'Открыть изучение',
  'dashboardHome.sections.attention.actions.addUpdate': 'Добавить обновление',
  'dashboardHome.sections.attention.actions.complete': 'Завершить',
  'addSermon.newSermon': 'Новая проповедь',
  'addSermon.titleLabel': 'Тема',
  'addSermon.titlePlaceholder': 'Введите тему',
  'addSermon.titleExample': 'Например: Верность',
  'addSermon.verseLabel': 'Текст',
  'addSermon.versePlaceholder': 'Введите текст',
  'addSermon.verseExample': 'Например: Иоанна 3:16',
  'addSermon.seriesLabel': 'Серия',
  'addSermon.noSeriesOption': 'Без серии',
  'addSermon.cancel': 'Отмена',
  'addSermon.save': 'Сохранить',
  'addSermon.plannedDateLabel': 'Планируемая дата',
  'addSermon.plannedDateHint': 'Детали можно добавить позже.',
  'common.saving': 'Сохранение...',
  'studiesWorkspace.newNote': 'Новая заметка',
  'studiesWorkspace.titleLabel': 'Заголовок',
  'studiesWorkspace.titlePlaceholder': 'Необязательный заголовок заметки',
  'studiesWorkspace.contentLabel': 'Ваши мысли',
  'studiesWorkspace.contentPlaceholder': 'Запишите наблюдение',
  'studiesWorkspace.type.note': 'Заметка',
  'studiesWorkspace.type.question': 'Вопрос',
  'studiesWorkspace.saveNote': 'Сохранить заметку',
  'studiesWorkspace.createError': 'Ошибка создания заметки',
  'prayer.create.title': 'Новая молитва',
  'prayer.create.titleLabel': 'Название',
  'prayer.create.titlePlaceholder': 'О чём молиться',
  'prayer.create.descriptionLabel': 'Описание',
  'prayer.create.descriptionPlaceholder': 'Детали молитвы',
  'prayer.create.tagsLabel': 'Теги',
  'prayer.create.tagsPlaceholder': 'семья, исцеление',
  'prayer.create.cancel': 'Отмена',
  'prayer.create.submit': 'Добавить молитву',
  'buttons.cancel': 'Отмена',
  'buttons.close': 'Закрыть',
  'buttons.saving': 'Сохранение...',
};

const mockInterpolate = (value: string, options?: Record<string, unknown>) =>
  value.replace(/{{(\w+)}}/g, (_, key: string) => String(options?.[key] ?? ''));

const dateKeyFromToday = (offsetDays: number) => {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
};

jest.mock('@locales/i18n', () => ({}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => mockInterpolate(mockTranslationMap[key] || key, options),
    i18n: { language: 'ru' },
  }),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
  }),
}));

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('@/hooks/useDashboardSermons', () => ({
  useDashboardSermons: () => mockUseDashboardSermons(),
}));

jest.mock('@/hooks/useDashboardOptimisticSermons', () => ({
  useDashboardOptimisticSermons: () => ({
    syncStatesById: {},
    actions: {
      createSermon: (...args: unknown[]) => mockCreateSermon(...args),
      saveEditedSermon: jest.fn(),
      deleteSermon: jest.fn(),
      retrySync: jest.fn(),
      dismissSyncError: jest.fn(),
    },
  }),
}));

jest.mock('@/hooks/useSeries', () => ({
  useSeries: () => mockUseSeries(),
}));

jest.mock('@/hooks/useStudyNotes', () => ({
  useStudyNotes: () => mockUseStudyNotes(),
}));

jest.mock('@/hooks/usePrayerRequests', () => ({
  usePrayerRequests: () => mockUsePrayerRequests(),
}));

jest.mock('@/hooks/useGroups', () => ({
  useGroups: () => mockUseGroups(),
}));

jest.mock('@/components/ui/DatePickerField', () => ({
  __esModule: true,
  default: ({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) => (
    <input id={id} value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));

jest.mock('@/services/firebaseAuth.service', () => ({
  auth: {
    currentUser: { uid: 'user-1' },
  },
}));

jest.mock('@/services/sermon.service', () => ({
  createSermon: (...args: unknown[]) => mockCreateSermon(...args),
}));

jest.mock('@/services/preachDates.service', () => ({
  addPreachDate: jest.fn(),
}));

describe('Dashboard page', () => {
  beforeEach(() => {
    const tomorrow = dateKeyFromToday(1);
    const staleDate = dateKeyFromToday(-10);

    mockUseAuth.mockReturnValue({ user: { uid: 'user-1' } });
    // Dashboard now creates via the optimistic buffered path, whose createSermon
    // resolves to the new client-generated id string (used to navigate).
    mockCreateSermon.mockResolvedValue('created-sermon-id');
    mockUseDashboardSermons.mockReturnValue({
      sermons: [
        {
          id: 'sermon-1',
          title: 'Верность под давлением',
          verse: 'Иакова 1:2-8',
          date: dateKeyFromToday(-2),
          updatedAt: dateKeyFromToday(-1),
          thoughts: [],
          userId: 'user-1',
          isPreached: false,
          preachDates: [
            {
              id: 'preach-1',
              date: tomorrow,
              status: 'planned',
              church: { id: 'church-1', name: 'Церковь' },
              createdAt: dateKeyFromToday(-3),
            },
          ],
        },
        {
          id: 'sermon-2',
          title: 'Псалом 23',
          verse: 'Псалом 23',
          date: dateKeyFromToday(-14),
          updatedAt: dateKeyFromToday(-7),
          thoughts: [],
          userId: 'user-1',
          isPreached: true,
        },
      ],
      loading: false,
      error: null,
      refresh: jest.fn(),
    });
    mockUseSeries.mockReturnValue({
      series: [
        {
          id: 'series-1',
          userId: 'user-1',
          title: 'Стойкость веры',
          theme: 'Иакова',
          bookOrTopic: 'Иакова',
          sermonIds: ['sermon-2', 'sermon-1'],
          color: '#7C3AED',
          status: 'active',
          createdAt: dateKeyFromToday(-20),
          updatedAt: dateKeyFromToday(-1),
        },
        {
          id: 'series-2',
          userId: 'user-1',
          title: 'Черновик без цвета',
          theme: 'Псалмы',
          bookOrTopic: 'Псалмы',
          sermonIds: [],
          status: 'draft',
          createdAt: dateKeyFromToday(-10),
          updatedAt: dateKeyFromToday(-3),
        },
      ],
      loading: false,
      error: null,
    });
    mockUseStudyNotes.mockReturnValue({
      notes: [
        {
          id: 'note-1',
          userId: 'user-1',
          title: 'Римлянам 8:18-27',
          content: 'Надежда в страдании',
          scriptureRefs: [{ id: 'ref-1', book: 'Римлянам', chapter: 8, fromVerse: 18, toVerse: 27 }],
          tags: ['Надежда'],
          type: 'note',
          isDraft: true,
          createdAt: dateKeyFromToday(-4),
          updatedAt: dateKeyFromToday(-2),
        },
        {
          id: 'note-2',
          userId: 'user-1',
          title: 'Вопрос по Иакову',
          content: 'Как объяснить испытания?',
          scriptureRefs: [{ id: 'ref-2', book: 'Иакова', chapter: 1, fromVerse: 2, toVerse: 8 }],
          tags: [],
          type: 'question',
          isDraft: false,
          createdAt: dateKeyFromToday(-1),
          updatedAt: dateKeyFromToday(-1),
        },
      ],
      loading: false,
      error: null,
    });
    mockUsePrayerRequests.mockReturnValue({
      prayerRequests: [
        {
          id: 'prayer-1',
          userId: 'user-1',
          title: 'Анна — восстановление после операции',
          description: 'Молиться о восстановлении и мире.',
          status: 'active',
          updates: [],
          createdAt: staleDate,
          updatedAt: staleDate,
        },
      ],
      loading: false,
      error: null,
      createPrayer: mockCreatePrayer,
    });
    mockUseGroups.mockReturnValue({
      groups: [
        {
          id: 'group-1',
          userId: 'user-1',
          title: 'Мужская группа',
          status: 'active',
          templates: [
            { id: 'tpl-1', type: 'scripture', title: 'Текст', content: 'Иакова 1', status: 'filled', createdAt: dateKeyFromToday(-3), updatedAt: dateKeyFromToday(-2) },
            { id: 'tpl-2', type: 'questions', title: 'Вопросы', content: '', status: 'draft', createdAt: dateKeyFromToday(-3), updatedAt: dateKeyFromToday(-2) },
          ],
          flow: [],
          meetingDates: [{ id: 'meeting-1', date: tomorrow, createdAt: dateKeyFromToday(-2) }],
          createdAt: dateKeyFromToday(-10),
          updatedAt: dateKeyFromToday(-1),
        },
        {
          id: 'group-2',
          userId: 'user-1',
          title: 'Домашнее общение',
          status: 'completed',
          templates: [
            { id: 'tpl-3', type: 'scripture', title: 'Текст', content: 'Псалом 23', status: 'filled', createdAt: dateKeyFromToday(-8), updatedAt: dateKeyFromToday(-4) },
          ],
          flow: [],
          meetingDates: [{ id: 'meeting-2', date: dateKeyFromToday(-5), createdAt: dateKeyFromToday(-8) }],
          createdAt: dateKeyFromToday(-12),
          updatedAt: dateKeyFromToday(-2),
        },
      ],
      loading: false,
      error: null,
    });
  });

  it('renders the localized dashboard as the default private page', () => {
    render(<DashboardPage />);

    expect(screen.getByRole('heading', { name: 'Панель' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Новая проповедь/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Добавить заметку/i })).toHaveAttribute('href', '/studies/new');
    expect(screen.getByRole('button', { name: /Добавить молитву/i })).toBeInTheDocument();
    expect(screen.getAllByText('Заметки').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Проповеди' })).toBeInTheDocument();
    expect(screen.getAllByText('Верность под давлением').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Псалом 23').length).toBeGreaterThan(0);
    expect(screen.getByText('Молитвенный фокус')).toBeInTheDocument();
    expect(screen.getByText('Анна — восстановление после операции')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Анна — восстановление после операции/ })).toHaveAttribute('href', '/prayers/prayer-1');
    expect(screen.queryByRole('button', { name: /Настройки панели/ })).not.toBeInTheDocument();
    const agendaSection = screen.getByRole('heading', { name: 'Эта неделя' }).closest('section') as HTMLElement;
    expect(within(agendaSection).getByRole('link', { name: /Верность под давлением/ })).toHaveAttribute('href', '/sermons/sermon-1');
    expect(within(agendaSection).getByRole('link', { name: /Мужская группа/ })).toHaveAttribute('href', '/groups/group-1');
    const seriesSection = screen.getByRole('heading', { name: 'Активные серии' }).closest('section') as HTMLElement;
    expect(within(seriesSection).getByText('Стойкость веры')).toBeInTheDocument();
    expect(within(seriesSection).getByRole('link', { name: /Стойкость веры/ })).toHaveAttribute('href', '/series/series-1');
    expect(within(seriesSection).getByTestId('series-color-series-1')).toHaveStyle('background-color: #7C3AED');
    expect(within(seriesSection).getByTestId('series-color-series-2')).toHaveStyle('background-color: #2563EB');
    const studiesSection = screen.getByRole('heading', { name: 'Последние заметки' }).closest('section') as HTMLElement;
    expect(within(studiesSection).getByRole('link', { name: /Римлянам 8:18-27/ })).toHaveAttribute('href', '/studies/note-1');
    expect(within(studiesSection).getByText('Надежда')).toBeInTheDocument();
    expect(within(studiesSection).getByText('Иакова 1:2-8')).toBeInTheDocument();
    expect(within(studiesSection).getByText('Вопрос')).toBeInTheDocument();
    expect(within(studiesSection).queryByText(/^Заметки\s+1$/)).not.toBeInTheDocument();
    expect(within(studiesSection).queryByText(/^Вопросы\s+0$/)).not.toBeInTheDocument();
    const groupsSection = screen.getByRole('heading', { name: 'Последние группы' }).closest('section') as HTMLElement;
    expect(within(groupsSection).getByText('Мужская группа')).toBeInTheDocument();
    expect(within(groupsSection).getByRole('link', { name: /Мужская группа/ })).toHaveAttribute('href', '/groups/group-1');
    expect(within(groupsSection).getByText('Домашнее общение')).toBeInTheDocument();
    expect(within(groupsSection).getByText('Активна')).toBeInTheDocument();
    expect(within(groupsSection).getByText('Завершена')).toBeInTheDocument();
    expect(screen.getByText('Требует внимания')).toBeInTheDocument();
  });

  it('opens create modals for sermon and prayer quick actions instead of navigating to sections', () => {
    render(<DashboardPage />);

    fireEvent.click(screen.getByRole('button', { name: /Новая проповедь/i }));
    expect(screen.getByRole('heading', { name: 'Новая проповедь' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));

    fireEvent.click(screen.getByRole('button', { name: /Добавить молитву/i }));
    expect(screen.getByRole('heading', { name: 'Новая молитва' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));

    expect(mockRouterPush).not.toHaveBeenCalledWith('/sermons');
    expect(mockRouterPush).not.toHaveBeenCalledWith('/prayers');
  });

  it('creates the sermon via the optimistic path and redirects to the created sermon', async () => {
    render(<DashboardPage />);

    fireEvent.click(screen.getByRole('button', { name: /Новая проповедь/i }));
    fireEvent.change(screen.getByPlaceholderText('Введите тему'), {
      target: { value: 'Created From Dashboard' },
    });
    fireEvent.change(screen.getByPlaceholderText('Введите текст'), {
      target: { value: 'John 1:1' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    // The dashboard delegates to the optimistic buffered create (not the direct
    // service), passing the typed title/verse.
    await waitFor(() => {
      expect(mockCreateSermon).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Created From Dashboard', verse: 'John 1:1' })
      );
    });

    // Online, it navigates to the new sermon's editor route...
    await waitFor(() => {
      expect(mockRouterPush).toHaveBeenCalledWith('/sermons/created-sermon-id');
    });

    // ...and the modal closes (closeOnSuccess).
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Новая проповедь' })).not.toBeInTheDocument();
    });
  });

  it('keeps the prayer create modal visible while redirecting to the created prayer', async () => {
    // createPrayer now returns the client-generated id string (for navigation).
    mockCreatePrayer.mockResolvedValue('created-prayer-id');

    render(<DashboardPage />);

    fireEvent.click(screen.getByRole('button', { name: /Добавить молитву/i }));
    fireEvent.change(screen.getByPlaceholderText('О чём молиться'), {
      target: { value: 'Created prayer from dashboard' },
    });

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Добавить молитву' }));

    await screen.findByRole('button', { name: 'Сохранение...' });

    expect(mockRouterPush).toHaveBeenCalledWith('/prayers/created-prayer-id');
    expect(screen.getByRole('heading', { name: 'Новая молитва' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Created prayer from dashboard')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Сохранение...' })).toBeDisabled();
  });

  it('shows recent past agenda events when there are no upcoming events', () => {
    mockUseDashboardSermons.mockReturnValue({
      sermons: [
        {
          id: 'sermon-past',
          title: 'Недавняя проповедь',
          verse: 'Луки 15',
          date: dateKeyFromToday(-3),
          updatedAt: dateKeyFromToday(-3),
          thoughts: [],
          userId: 'user-1',
          isPreached: true,
          preachDates: [
            {
              id: 'preach-past',
              date: dateKeyFromToday(-3),
              status: 'preached',
              church: { id: 'church-1', name: 'Церковь' },
              createdAt: dateKeyFromToday(-4),
            },
          ],
        },
      ],
      loading: false,
      error: null,
      refresh: jest.fn(),
    });
    mockUseGroups.mockReturnValue({
      groups: [
        {
          id: 'group-past',
          userId: 'user-1',
          title: 'Прошедшая группа',
          status: 'completed',
          templates: [
            { id: 'tpl-past', type: 'scripture', title: 'Текст', content: 'Иоанна 10', status: 'filled', createdAt: dateKeyFromToday(-7), updatedAt: dateKeyFromToday(-2) },
          ],
          flow: [],
          meetingDates: [{ id: 'meeting-past', date: dateKeyFromToday(-2), createdAt: dateKeyFromToday(-7) }],
          createdAt: dateKeyFromToday(-9),
          updatedAt: dateKeyFromToday(-2),
        },
      ],
      loading: false,
      error: null,
    });

    render(<DashboardPage />);

    const agendaSection = screen.getByRole('heading', { name: 'Эта неделя' }).closest('section') as HTMLElement;
    expect(within(agendaSection).getByText('Недавняя проповедь')).toBeInTheDocument();
    expect(within(agendaSection).getByText('Прошедшая группа')).toBeInTheDocument();
  });
});
