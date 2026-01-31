когда пункт плана заблокирован, то кнопки добавить в ручную и добавить диктовку на странице структуры в columns должны быть не активными.

---

Нужно также добавить в режим проповеди возможно отдельно устаналвивать время для вступления, основной части и заключения.

---

если проповедь содержит два стиха, но в экспорт word идет только первый стих.

---

GET: Total sermons retrieved: 46
 GET /api/sermons?userId=Jhwh42NbpLRSoKltDdHr15QLsfJ3 200 in 936ms
 GET /sermons/9UIlwqjnE7eJEAoCUEPQ 200 in 31ms
GET: Request received for retrieving series
GET: Fetching series for userId: Jhwh42NbpLRSoKltDdHr15QLsfJ3 from Firestore...
Firestore: fetching series for user Jhwh42NbpLRSoKltDdHr15QLsfJ3
Firestore: fetching sermon 9UIlwqjnE7eJEAoCUEPQ
Retrieved 7 series for user Jhwh42NbpLRSoKltDdHr15QLsfJ3
GET: Total series retrieved: 7
 GET /api/series?userId=Jhwh42NbpLRSoKltDdHr15QLsfJ3 200 in 55ms
Sermon retrieved: with id 9UIlwqjnE7eJEAoCUEPQ and title Духовное разумение (семейная группа)
 GET /api/sermons/9UIlwqjnE7eJEAoCUEPQ 200 in 75ms

[debug] ReactQuery cache persisted {key: 'react-query-cache', queries: 23}
workbox-e43f5367.js:44 workbox Router is responding to: /sermons/9UIlwqjnE7eJEAoCUEPQ?_rsc=sby9i
workbox-e43f5367.js:44 workbox Using NetworkOnly to respond to '/sermons/9UIlwqjnE7eJEAoCUEPQ?_rsc=sby9i'
debugMode.ts:19 [debug] 🔐 useAuth: user: Jhwh42NbpLRSoKltDdHr15QLsfJ3 loading: false
debugMode.ts:19 [debug] 🔐 useAuth: user: Jhwh42NbpLRSoKltDdHr15QLsfJ3 loading: false
debugMode.ts:19 [debug] 🔧 DashboardNav: showWizardButton: true prepModeLoading: false
debugMode.ts:19 [debug] 🔐 useAuth: user: Jhwh42NbpLRSoKltDdHr15QLsfJ3 loading: false
debugMode.ts:19 [debug] 🔐 useAuth: user: Jhwh42NbpLRSoKltDdHr15QLsfJ3 loading: false
debugMode.ts:19 [debug] 🔧 DashboardNav: showWizardButton: true prepModeLoading: false
debugMode.ts:19 [debug] 🔐 useAuth: user: Jhwh42NbpLRSoKltDdHr15QLsfJ3 loading: false
debugMode.ts:19 [debug] 🔐 useAuth: user: Jhwh42NbpLRSoKltDdHr15QLsfJ3 loading: false
debugMode.ts:19 [debug] ReactQuery cache persisted {key: 'react-query-cache', queries: 23}
workbox-e43f5367.js:44 workbox Router is responding to: /api/sermons/9UIlwqjnE7eJEAoCUEPQ
workbox-e43f5367.js:44 workbox Router is responding to: /api/series?userId=Jhwh42NbpLRSoKltDdHr15QLsfJ3
debugMode.ts:19 [debug] Online status initialized {isOnline: true}
debugMode.ts:19 [debug] Online status initialized {isOnline: true}
debugMode.ts:19 [debug] Series state {isOnline: true, userId: 'Jhwh42NbpLRSoKltDdHr15QLsfJ3', count: 0, isLoading: true, isFetching: true}
debugMode.ts:19 [debug] Online status initialized {isOnline: true}
debugMode.ts:19 [debug] Online status initialized {isOnline: true}
debugMode.ts:19 [debug] Online status initialized {isOnline: true}
debugMode.ts:19 [debug] Online status initialized {isOnline: true}
debugMode.ts:19 [debug] Online status initialized {isOnline: true}
debugMode.ts:19 [debug] Tags state {isOnline: true, userId: undefined, requiredCount: 0, customCount: 0, isLoading: true}
workbox-e43f5367.js:44 workbox Using NetworkOnly to respond to '/api/series?userId=Jhwh42NbpLRSoKltDdHr15QLsfJ3'
debugMode.ts:19 [debug] Tags state {isOnline: true, userId: undefined, requiredCount: 3, customCount: 0, isLoading: false}
workbox-e43f5367.js:44 workbox Using NetworkOnly to respond to '/api/sermons/9UIlwqjnE7eJEAoCUEPQ'
debugMode.ts:19 [debug] Series state {isOnline: true, userId: 'Jhwh42NbpLRSoKltDdHr15QLsfJ3', count: 7, isLoading: false, isFetching: false}
debugMode.ts:19 [debug] ReactQuery cache persisted {key: 'react-query-cache', queries: 23}
debugMode.ts:19 [debug] ReactQuery cache persisted {key: 'react-query-cache', queries: 23}
debugMode.ts:19 [debug] ReactQuery cache persisted {key: 'react-query-cache', queries: 23}
debugMode.ts:19 [debug] ReactQuery cache persisted {key: 'react-query-cache', queries: 23}
debugMode.ts:19 [debug] ReactQuery cache persisted {key: 'react-query-cache', queries: 23}
debugMode.ts:19 [debug] ReactQuery cache persisted {key: 'react-query-cache', queries: 24}

и страница показывает 
```
Загрузка...
Назад к списку
```

---

I need to find all places where order of thoughts is used and incapsulate logic to use the same logic evrywhere. 

---