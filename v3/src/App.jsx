import { Routes, Route } from 'react-router-dom'
import AuroraBg from './components/AuroraBg.jsx'
import Navbar from './components/Navbar.jsx'
import Footer from './components/Footer.jsx'
import TabBar from './components/TabBar.jsx'
import { SearchProvider } from './components/SearchPanel.jsx'
import Home from './pages/Home.jsx'
import Board from './pages/Board.jsx'
import City from './pages/City.jsx'

export default function App() {
  return (
    <SearchProvider>
      <AuroraBg />
      <Navbar />
      <main id="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/board" element={<Board />} />
          <Route path="/city" element={<City />} />
        </Routes>
      </main>
      <Footer />
      <TabBar />
    </SearchProvider>
  )
}
