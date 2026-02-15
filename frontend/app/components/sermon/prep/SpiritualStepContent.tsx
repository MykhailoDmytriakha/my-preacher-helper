'use client';

import { BookOpen, Sparkles, Wrench, AlertTriangle } from 'lucide-react';
import React from 'react';

import { UI_COLORS } from '@/utils/themeColors';

import type { Preparation } from '@/models/models';

interface SpiritualStepContentProps {
  prepDraft: Preparation;
  setPrepDraft: (p: Preparation) => void;
  savePreparation: (p: Preparation) => void | Promise<void>;
  savingPrep: boolean;
  formatSuperscriptVerses: (text: string) => string;
}

const SpiritualStepContent: React.FC<SpiritualStepContentProps> = ({
  prepDraft,
  setPrepDraft,
  savePreparation,
  savingPrep,
  formatSuperscriptVerses,
}) => {
  return (
    <div className={`space-y-3 relative rounded-xl transition-all duration-700 ${!prepDraft?.spiritual?.readAndPrayedConfirmed
      ? 'p-4 border-2 border-red-200 dark:border-red-900/30'
      : 'p-0 border-0'
      }`}>
      {/* Outer pulsing beacon border */}
      {!prepDraft?.spiritual?.readAndPrayedConfirmed && (
        <div className="absolute inset-0 rounded-xl border-4 border-red-500/20 dark:border-red-500/10 animate-pulse pointer-events-none shadow-[0_0_30px_rgba(239,68,68,0.15)] z-0" />
      )}

      <div className="relative z-10 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <BookOpen className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <span className="text-gray-700 dark:text-gray-300">Перед началом прочитайте текст</span>
        </div>
        <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
          <div
            className="text-sm whitespace-pre-line leading-6 text-gray-800 dark:text-gray-100"
            dangerouslySetInnerHTML={{
              __html: formatSuperscriptVerses(
                `9 О пророках. Сердце мое во мне раздирается, все кости мои сотрясаются; я - как пьяный, как человек, которого одолело вино, ради Господа и ради святых слов Его, 10 потому что земля наполнена прелюбодеями, потому что плачет земля от проклятия; засохли пастбища пустыни, и стремление их - зло, и сила их - неправда, 11 ибо и пророк и священник - лицемеры; даже в доме Моем Я нашел нечестие их, говорит Господь. 12 За то путь их будет для них, как скользкие места в темноте: их толкнут, и они упадут там; ибо Я наведу на них бедствие, год посещения их, говорит Господь. 13 И в пророках Самарии Я видел безумие; они пророчествовали именем Ваала, и ввели в заблуждение народ Мой, Израиля. 14 Но в пророках Иерусалима вижу ужасное: они прелюбодействуют и ходят во лжи, поддерживают руки злодеев, чтобы никто не обращался от своего нечестия; все они предо Мною - как Содом, и жители его - как Гоморра. 15 Посему так говорит Господь Саваоф о пророках: вот, Я накормлю их полынью и напою их водою с желчью, ибо от пророков Иерусалимских нечестие распространилось на всю землю. 16 Так говорит Господь Саваоф: не слушайте слов пророков, пророчествующих вам: они обманывают вас, рассказывают мечты сердца своего, [а] не от уст Господних. 17 Они постоянно говорят пренебрегающим Меня: "Господь сказал: мир будет у вас". И всякому, поступающему по упорству своего сердца, говорят: "не придет на вас беда". 18 Ибо кто стоял в совете Господа и видел и слышал слово Его? Кто внимал слову Его и услышал? 19 Вот, идет буря Господня с яростью, буря грозная, и падет на главу нечестивых. 20 Гнев Господа не отвратится, доколе Он не совершит и доколе не выполнит намерений сердца Своего; в последующие дни вы ясно уразумеете это. 21 Я не посылал пророков сих, а они сами побежали; Я не говорил им, а они пророчествовали. 22 Если бы они стояли в Моем совете, то объявили бы народу Моему слова Мои и отводили бы их от злого пути их и от злых дел их. 23 Разве Я - Бог [только] вблизи, говорит Господь, а не Бог и вдали? 24 Может ли человек скрыться в тайное место, где Я не видел бы его? говорит Господь. Не наполняю ли Я небо и землю? говорит Господь. 25 Я слышал, что говорят пророки, Моим именем пророчествующие ложь. Они говорят: "мне снилось, мне снилось". 26 Долго ли это будет в сердце пророков, пророчествующих ложь, пророчествующих обман своего сердца? 27 Думают ли они довести народ Мой до забвения имени Моего посредством снов своих, которые они пересказывают друг другу, как отцы их забыли имя Мое из-за Ваала? 28 Пророк, который видел сон, пусть и рассказывает его как сон; а у которого Мое слово, тот пусть говорит слово Мое верно. Что общего у мякины с чистым зерном? говорит Господь. 29 Слово Мое не подобно ли огню, говорит Господь, и не подобно ли молоту, разбивающему скалу? 30 Посему, вот Я - на пророков, говорит Господь, которые крадут слова Мои друг у друга. 31 Вот, Я - на пророков, говорит Господь, которые действуют своим языком, а говорят: "Он сказал". 32 Вот, Я - на пророков ложных снов, говорит Господь, которые рассказывают их и вводят народ Мой в заблуждение своими обманами и обольщением, тогда как Я не посылал их и не повелевал им, и они никакой пользы не приносят народу сему, говорит Господь. (Иер.23:9-32)`
              )
                .replace(
                  'не слушайте слов пророков, пророчествующих вам: они обманывают вас, рассказывают мечты сердца своего, [а] не от уст Господних.',
                  '<u>не слушайте слов пророков, пророчествующих вам: они обманывают вас, рассказывают мечты сердца своего, [а] не от уст Господних.</u>'
                )
                .replace(
                  'Если бы они стояли в Моем совете, то объявили бы народу Моему слова Мои и отводили бы их от злого пути их и от злых дел их.',
                  '<u>Если бы они стояли в Моем совете, то объявили бы народу Моему слова Мои и отводили бы их от злого пути их и от злых дел их.</u>'
                )
                .replace(
                  'Пророк, который видел сон, пусть и рассказывает его как сон; а у которого Мое слово, тот пусть говорит слово Мое верно.',
                  '<u>Пророк, который видел сон, пусть и рассказывает его как сон; а у которого Мое слово, тот пусть говорит слово Мое верно.</u>'
                )
                .replace(
                  'Слово Мое не подобно ли огню, говорит Господь, и не подобно ли молоту, разбивающему скалу?',
                  '<u>Слово Мое не подобно ли огню, говорит Господь, и не подобно ли молоту, разбивающему скалу?</u>'
                ),
            }}
          />
        </div>

        <div className="mt-4">
          <h3 className="text-base font-semibold">Размышления перед подготовкой</h3>
          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-3 rounded-md border border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                <h4 className="text-sm font-semibold">Духовная часть</h4>
              </div>
              <ul className="list-disc pl-5 mt-1 space-y-1 text-sm">
                <li>
                  Неем 8:8: &ldquo;
                  <sup className="text-gray-300 dark:text-gray-800">8</sup>
                  {' '}И читали из книги, из закона Божия, внятно, и присоединяли толкование, и народ понимал прочитанное.&rdquo;
                </li>
                <li>Проповедь в Силе Духа, сильная проповедь исходит не от проповедника, а от Духа Святого</li>
                <li>
                  Проповедь Божьих истин и Божьего слова, а не человеческой мудрости.
                  <div className="mt-1 ml-4">
                    <div className="text-[13px] text-gray-700 dark:text-gray-300">Потому что только Божье Слово может менять людей, и имеет абсолютный авторитет</div>
                  </div>
                </li>
                <li>После проповеди, что люди скажут: какой хороший проповедник или какой великий Бог?</li>
                <li>
                  Проповедь должна оказывать пронизывающий эффект на самого проповедника в процессе подготовки.
                  <div className="mt-1 ml-4">
                    <div className="text-[13px] text-gray-700 dark:text-gray-300">Слово Божье полезно для проповедника, и оно должно иметь эффект на проповедника</div>
                  </div>
                </li>
              </ul>
            </div>
            <div className="p-3 rounded-md border border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2 mb-1">
                <Wrench className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                <h4 className="text-sm font-semibold">Техническая часть</h4>
              </div>
              <ul className="list-disc pl-5 mt-1 space-y-1 text-sm">
                <li>Ты как режиссёр: спланируй как ты поведешь слушателей к Библейской истине</li>
                <li>Проповедник не повар, он официант: так что нужно получить рецепт от Бога</li>
              </ul>
            </div>
          </div>
        </div>

        <div
          className={`mt-6 transition-all duration-500 ease-in-out rounded-xl overflow-hidden ${!prepDraft?.spiritual?.readAndPrayedConfirmed
            ? `p-6 border-l-8 border-red-500 bg-red-50 dark:bg-red-900/20 shadow-[0_0_30px_rgba(239,68,68,0.15)] animate-pulse`
            : `p-4 border-l-4 border-green-500 bg-gray-50 dark:bg-gray-800/50`
            }`}
        >
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              {!prepDraft?.spiritual?.readAndPrayedConfirmed ? (
                <AlertTriangle className="w-8 h-8 text-red-600 dark:text-red-400" />
              ) : (
                <Sparkles className="w-5 h-5 text-green-600 dark:text-green-400" />
              )}

              <h3 className={`font-bold transition-all ${!prepDraft?.spiritual?.readAndPrayedConfirmed
                ? 'text-2xl text-red-700 dark:text-red-300 uppercase tracking-wide'
                : 'text-base text-gray-700 dark:text-gray-300'
                }`}>
                Молитва
              </h3>
            </div>

            {!prepDraft?.spiritual?.readAndPrayedConfirmed && (
              <p className="text-red-800 dark:text-red-200 font-semibold text-lg ml-1">
                Этот шаг нельзя пропускать, ни при каких обстоятельствах
              </p>
            )}

            <div className="flex items-center gap-4 mt-2">
              <input
                id="readAndPrayed"
                type="checkbox"
                className={`cursor-pointer transition-all ${!prepDraft?.spiritual?.readAndPrayedConfirmed
                  ? 'w-6 h-6 accent-red-600 hover:accent-red-700 scale-125'
                  : 'w-5 h-5 accent-green-600'
                  }`}
                checked={Boolean(prepDraft?.spiritual?.readAndPrayedConfirmed)}
                onChange={(e) => {
                  const next: Preparation = {
                    ...prepDraft,
                    spiritual: { ...(prepDraft.spiritual ?? {}), readAndPrayedConfirmed: e.target.checked },
                  };
                  setPrepDraft(next);
                  savePreparation(next);
                }}
              />
              <label
                htmlFor="readAndPrayed"
                className={`cursor-pointer select-none transition-all ${!prepDraft?.spiritual?.readAndPrayedConfirmed
                  ? 'text-xl font-bold text-red-900 dark:text-red-100 underline decoration-red-400 underline-offset-4'
                  : 'text-sm text-gray-500 dark:text-gray-400 line-through decoration-green-500/50'
                  }`}
              >
                {prepDraft?.spiritual?.readAndPrayedConfirmed
                  ? 'Шаг выполнен: Писание прочитано, молитва совершена' // Feedback
                  : 'Отметьте, когда прочитали и помолились' // Actionable
                }
              </label>
            </div>
          </div>
        </div>

        <div className="text-xs text-gray-500">{savingPrep ? 'Сохранение...' : 'Сохранено'}</div>
      </div>
    </div>
  );
};


export default SpiritualStepContent;
