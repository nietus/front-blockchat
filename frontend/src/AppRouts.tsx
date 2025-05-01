import { Route, Routes } from "react-router-dom";
import Home from "./pages/Home";

export default function AppRoutes() {
    return (
        <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/algo" element={<h1>Home</h1>} />
            <Route path="/*" element={<h1>404</h1>} />
        </Routes>
    )
}