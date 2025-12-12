'use client';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import FeatureCards from '@/components/landing/FeatureCards';
import LandingFooter from '@/components/landing/LandingFooter';
import LandingHeader from '@/components/landing/LandingHeader';
import LoginOptions from '@/components/landing/LoginOptions';
import PublicRoute from '@/components/PublicRoute';
import '@locales/i18n';
import { auth, signInWithGoogle } from '@/services/firebaseAuth.service';
import { CheckIcon, DocumentIcon, LightBulbIcon, MicrophoneIcon } from '@components/Icons';

export default function Home() {
  const router = useRouter();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    try {
      setLoading(true);
      await signInWithGoogle();
      router.push('/dashboard');
    } catch (error) {
      console.error('Login error', error);
    } finally {
      setLoading(false);
    }
  };



  const handleTestLogin = async () => {
    try {
      setLoading(true);
      await signInWithEmailAndPassword(auth, 'testuser@example.com', 'TestPassword123');
      router.push('/dashboard');
    } catch (error) {
      console.error('Test login failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const valuePoints = useMemo(
    () => [
      t('landing.valueCapture'),
      t('landing.valueStructure'),
      t('landing.valueDeliver'),
    ],
    [t]
  );

  const workflowSteps = useMemo(
    () => [
      {
        title: t('landing.workflowCaptureTitle'),
        description: t('landing.workflowCaptureDescription'),
      },
      {
        title: t('landing.workflowShapeTitle'),
        description: t('landing.workflowShapeDescription'),
      },
      {
        title: t('landing.workflowDeliverTitle'),
        description: t('landing.workflowDeliverDescription'),
      },
    ],
    [t]
  );

  const highlightItems = useMemo(
    () => [
      {
        icon: <MicrophoneIcon className="w-4 h-4 text-blue-500" />,
        label: t('featureCards.recordingTitle'),
        helper: t('landing.valueCapture'),
      },
      {
        icon: <LightBulbIcon className="w-4 h-4 text-amber-500" />,
        label: t('featureCards.structuringTitle'),
        helper: t('landing.valueStructure'),
      },
      {
        icon: <DocumentIcon className="w-4 h-4 text-emerald-500" />,
        label: t('featureCards.analysisTitle'),
        helper: t('landing.valueDeliver'),
      },
    ],
    [t]
  );

  return (
    <PublicRoute>
      <div className="relative min-h-screen overflow-hidden bg-gradient-to-b from-slate-50 via-white to-slate-100 text-slate-900 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 dark:text-slate-50">
        <div className="pointer-events-none absolute inset-0 opacity-80">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(59,130,246,0.18),transparent_35%),radial-gradient(circle_at_80%_0%,rgba(168,85,247,0.16),transparent_32%),radial-gradient(circle_at_50%_80%,rgba(16,185,129,0.14),transparent_30%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.6)_0%,rgba(255,255,255,0)_25%,rgba(255,255,255,0)_75%,rgba(15,23,42,0.15)_100%)] dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.65)_0%,rgba(15,23,42,0)_30%)]" />
        </div>

        <LandingHeader />

        <main
          id="main-content"
          tabIndex={-1}
          className="relative z-10 mx-auto flex max-w-6xl flex-col gap-16 px-4 pb-16 pt-10 sm:px-6 lg:px-8"
        >
          <section className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="space-y-6">
              <div className="space-y-3">
                <h1 className="flex flex-wrap text-left text-4xl font-bold leading-tight text-slate-900 sm:text-5xl dark:text-white">
                  <span className="text-left" suppressHydrationWarning={true}>
                    {t('landing.title')}
                  </span>
                </h1>
                <div className="flex items-center gap-3 rounded-full border border-slate-200/60 bg-white/70 px-4 py-2 text-xs font-semibold uppercase tracking-tight text-slate-700 shadow-sm shadow-blue-100 backdrop-blur text-center dark:border-white/20 dark:bg-white/5 dark:text-slate-100 dark:shadow-none">
                  <span className="text-center text-emerald-500 dark:text-emerald-300">
                    <span
                      className="flex flex-wrap items-center justify-center align-middle"
                      style={{ verticalAlign: 'middle' }}
                      suppressHydrationWarning={true}
                    >
                      {t('landing.welcome', { defaultValue: 'Welcome to Preacher Helper' })}
                    </span>
                  </span>
                </div>
                <p className="text-lg leading-relaxed text-slate-700 sm:text-xl dark:text-slate-200">
                  <span suppressHydrationWarning={true}>{t('landing.subtitle')}</span>
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {valuePoints.map((point) => (
                  <div
                    key={point}
                    className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white/80 p-3 shadow-sm shadow-blue-50 backdrop-blur dark:border-white/10 dark:bg-white/5 dark:shadow-none"
                  >
                    <div className="mt-1 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-200">
                      <CheckIcon className="h-3.5 w-3.5" />
                    </div>
                    <p className="text-sm leading-6 text-slate-700 dark:text-slate-200">
                      <span suppressHydrationWarning={true}>{point}</span>
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-3xl border border-slate-200/70 bg-white/90 p-6 shadow-2xl shadow-blue-100 backdrop-blur dark:border-white/10 dark:bg-white/5 dark:shadow-none">
                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-300">
                      <span suppressHydrationWarning={true}>{t('landing.heroHighlightTitle')}</span>
                    </p>
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      <span suppressHydrationWarning={true}>{t('landing.heroHighlightSubtitle')}</span>
                    </p>
                  </div>
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-center text-xs font-semibold text-blue-700 dark:bg-blue-500/20 dark:text-blue-100">
                    <span suppressHydrationWarning={true}>{t('landing.heroHighlightBadge')}</span>
                  </span>
                </div>

                <div className="mt-5 space-y-3">
                  {highlightItems.map((item) => (
                    <div
                      key={item.label}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200/70 bg-gradient-to-r from-slate-50 via-white to-white px-4 py-3 shadow-sm shadow-blue-50 dark:border-white/10 dark:from-white/10 dark:via-white/5 dark:to-white/5"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white shadow-sm shadow-blue-100 dark:bg-white/10">
                          {item.icon}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-800 dark:text-white">
                            <span suppressHydrationWarning={true}>{item.label}</span>
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-300">
                            <span suppressHydrationWarning={true}>{item.helper}</span>
                          </p>
                        </div>
                      </div>
                      <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200">
                        {t('landing.heroHighlightState')}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-5 grid gap-3 rounded-2xl border border-slate-200/70 bg-slate-50/70 p-4 shadow-inner shadow-blue-50 dark:border-white/10 dark:bg-white/5 dark:shadow-none sm:grid-cols-3">
                  <div className="space-y-1 rounded-xl bg-white/80 p-3 shadow-sm dark:bg-white/10">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
                      <span suppressHydrationWarning={true}>{t('landing.metricRecordings')}</span>
                    </p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white">24</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      <span suppressHydrationWarning={true}>{t('landing.metricRecordingsHint')}</span>
                    </p>
                  </div>
                  <div className="space-y-1 rounded-xl bg-white/80 p-3 shadow-sm dark:bg-white/10">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
                      <span suppressHydrationWarning={true}>{t('landing.metricPlan')}</span>
                    </p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white">3x</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      <span suppressHydrationWarning={true}>{t('landing.metricPlanHint')}</span>
                    </p>
                  </div>
                  <div className="space-y-1 rounded-xl bg-white/80 p-3 shadow-sm dark:bg-white/10">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
                      <span suppressHydrationWarning={true}>{t('landing.metricConfidence')}</span>
                    </p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white">95%</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      <span suppressHydrationWarning={true}>{t('landing.metricConfidenceHint')}</span>
                    </p>
                  </div>
                </div>
              </div>

            </div>
          </section>

          <section className="flex justify-center">
            <LoginOptions onGoogleLogin={handleLogin} onTestLogin={handleTestLogin} loading={loading} />
          </section>

          <section className="space-y-6">
            <div className="space-y-2">
              <p className="text-sm font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-300">
                <span suppressHydrationWarning={true}>{t('landing.featuresSubtitle')}</span>
              </p>
              <h2 className="text-3xl font-semibold text-slate-900 dark:text-white">
                <span suppressHydrationWarning={true}>{t('landing.featuresTitle')}</span>
              </h2>
            </div>
            <FeatureCards />
          </section>

          <section className="space-y-6">
            <div className="space-y-2">
              <p className="text-sm font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-300">
                <span suppressHydrationWarning={true}>{t('landing.workflowSubtitle')}</span>
              </p>
              <h2 className="text-3xl font-semibold text-slate-900 dark:text-white">
                <span suppressHydrationWarning={true}>{t('landing.workflowTitle')}</span>
              </h2>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {workflowSteps.map((step) => (
                <div
                  key={step.title}
                  className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/80 p-5 shadow-sm shadow-blue-50 backdrop-blur dark:border-white/10 dark:bg-white/5 dark:shadow-none"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-r from-blue-500/80 to-purple-500/70 text-white shadow-md shadow-blue-200/40 dark:shadow-none">
                    <LightBulbIcon className="h-4 w-4" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-lg font-semibold text-slate-900 dark:text-white">
                      <span suppressHydrationWarning={true}>{step.title}</span>
                    </p>
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      <span suppressHydrationWarning={true}>{step.description}</span>
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>

        </main>

        <LandingFooter />
      </div>
    </PublicRoute>
  );
}
