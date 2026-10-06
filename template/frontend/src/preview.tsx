import {renderToStaticMarkup} from 'react-dom/server';import {MemoryRouter} from 'react-router-dom';import {App} from './App';
export function renderPage(path:string){return renderToStaticMarkup(<MemoryRouter initialEntries={[path]}><App preview/></MemoryRouter>)}
