from pathlib import Path
import subprocess,re,json
# Run from the repository root. Git is read only; generated modules live in the evidence archive.
root=Path(__file__).resolve().parents[2];q=root/'.cases/2026-11-12-dvizhok-dannyh-do-ideala/research/125-probes'
q.mkdir(parents=True,exist_ok=True)
paths=['frontend/app/(pages)/(private)/studies/[id]/page.tsx','frontend/app/(pages)/(private)/studies/[id]/useNoteAutoSave.ts','frontend/app/components/ui/RichMarkdownEditor.tsx']
def frozen(rev,path):
 raw=subprocess.check_output(['git','show',rev+':'+path],text=True)
 def norm(m):
  dest=(root/Path(path).parent/m[2]).resolve().relative_to(root/'frontend/app')
  return m[1]+'@/'+str(dest)+m[3]
 raw=re.sub(r"(from\s*['\"])(\.[^'\"]+)(['\"])",norm,raw)
 dest=q/(rev+'-'+Path(path).name);dest.write_text(raw);return str(dest)
for name,rev in [('production','38ce9c1f6'),('candidate','751f5a0ef'),('head','0565dcc24')]:
 mapping={'^@lib/(.*)$':str(root/'frontend/lib/$1')}
 for path in paths if name=='production' else paths[:1]:
  alias='@/'+str(Path(path).relative_to('frontend/app')).rsplit('.',1)[0]
  mapping['^'+re.escape(alias)+'$']=frozen(rev,path)
 config='''import base from '../../../../frontend/jest.config';
export default async () => {
 const config = await base();
 const transform = Object.fromEntries(Object.entries(config.transform ?? {}).map(([pattern, entry]) => {
  if (!Array.isArray(entry) || !String(entry[0]).includes('swc/jest-transformer')) return [pattern, entry];
  const options = entry[1] as any;
  return [pattern, [entry[0], { ...options, jsConfig: { ...options.jsConfig, compilerOptions: { ...options.jsConfig.compilerOptions, paths: {} } } }]];
 }));
 return { ...config, transform, rootDir: ROOT, moduleDirectories: [ROOT+'/node_modules', ...(config.moduleDirectories ?? [])], moduleNameMapper: { ...MAPPING, ...config.moduleNameMapper } };
};
'''.replace('ROOT',json.dumps(str(root/'frontend'))).replace('MAPPING',json.dumps(mapping))
 (q/('jest-'+name+'.config.ts')).write_text(config)
