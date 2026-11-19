package dev.trace.device

/**
 * A small JSON encoder and parser, so the core has no dependencies and works the same on the JVM and on Android.
 * Maps, lists, strings, numbers, booleans and null only.
 */
object Json {
    fun stringify(value: Any?): String = StringBuilder().also { write(it, value) }.toString()

    fun parse(text: String): Any? {
        val p = Parser(text)
        val v = p.value()
        p.skipWhitespace()
        if (!p.atEnd()) throw IllegalArgumentException("Trailing characters in JSON")
        return v
    }

    private fun write(sb: StringBuilder, v: Any?) {
        when (v) {
            null -> sb.append("null")
            is String -> quote(sb, v)
            is Boolean -> sb.append(v.toString())
            is Int, is Long, is Short, is Byte -> sb.append(v.toString())
            is Double -> sb.append(number(v))
            is Float -> sb.append(number(v.toDouble()))
            is Map<*, *> -> {
                sb.append('{')
                var first = true
                for ((k, value) in v) {
                    if (!first) sb.append(',')
                    first = false
                    quote(sb, k.toString())
                    sb.append(':')
                    write(sb, value)
                }
                sb.append('}')
            }
            is Iterable<*> -> {
                sb.append('[')
                var first = true
                for (item in v) {
                    if (!first) sb.append(',')
                    first = false
                    write(sb, item)
                }
                sb.append(']')
            }
            else -> quote(sb, v.toString())
        }
    }

    /** A number the way JavaScript prints it: whole values without a trailing ".0". */
    internal fun number(d: Double): String =
        if (d == Math.floor(d) && Math.abs(d) < 1e15) d.toLong().toString() else d.toString()

    private fun quote(sb: StringBuilder, s: String) {
        sb.append('"')
        for (c in s) {
            when (c) {
                '"' -> sb.append("\\\"")
                '\\' -> sb.append("\\\\")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                else -> if (c.code < 0x20) sb.append(String.format("\\u%04x", c.code)) else sb.append(c)
            }
        }
        sb.append('"')
    }

    private class Parser(private val s: String) {
        private var i = 0

        fun atEnd() = i >= s.length

        fun skipWhitespace() {
            while (i < s.length && s[i].isWhitespace()) i++
        }

        fun value(): Any? {
            skipWhitespace()
            if (atEnd()) throw IllegalArgumentException("Unexpected end of JSON")
            return when (val c = s[i]) {
                '{' -> obj()
                '[' -> arr()
                '"' -> str()
                't' -> literal("true", true)
                'f' -> literal("false", false)
                'n' -> literal("null", null)
                else -> if (c == '-' || c.isDigit()) num() else throw IllegalArgumentException("Unexpected character '$c' in JSON")
            }
        }

        private fun literal(word: String, result: Any?): Any? {
            if (!s.startsWith(word, i)) throw IllegalArgumentException("Invalid JSON literal")
            i += word.length
            return result
        }

        private fun obj(): Map<String, Any?> {
            val out = LinkedHashMap<String, Any?>()
            i++ // {
            skipWhitespace()
            if (s[i] == '}') { i++; return out }
            while (true) {
                skipWhitespace()
                val key = str()
                skipWhitespace()
                if (s[i] != ':') throw IllegalArgumentException("Expected ':' in JSON object")
                i++
                out[key] = value()
                skipWhitespace()
                when (s[i++]) {
                    ',' -> continue
                    '}' -> return out
                    else -> throw IllegalArgumentException("Expected ',' or '}' in JSON object")
                }
            }
        }

        private fun arr(): List<Any?> {
            val out = ArrayList<Any?>()
            i++ // [
            skipWhitespace()
            if (s[i] == ']') { i++; return out }
            while (true) {
                out.add(value())
                skipWhitespace()
                when (s[i++]) {
                    ',' -> continue
                    ']' -> return out
                    else -> throw IllegalArgumentException("Expected ',' or ']' in JSON array")
                }
            }
        }

        private fun str(): String {
            if (s[i] != '"') throw IllegalArgumentException("Expected string in JSON")
            i++
            val sb = StringBuilder()
            while (true) {
                if (i >= s.length) throw IllegalArgumentException("Unterminated string in JSON")
                val c = s[i++]
                when (c) {
                    '"' -> return sb.toString()
                    '\\' -> {
                        when (val e = s[i++]) {
                            '"' -> sb.append('"')
                            '\\' -> sb.append('\\')
                            '/' -> sb.append('/')
                            'b' -> sb.append('\b')
                            'f' -> sb.append('\u000C')
                            'n' -> sb.append('\n')
                            'r' -> sb.append('\r')
                            't' -> sb.append('\t')
                            'u' -> { sb.append(s.substring(i, i + 4).toInt(16).toChar()); i += 4 }
                            else -> throw IllegalArgumentException("Bad escape '\\$e' in JSON")
                        }
                    }
                    else -> sb.append(c)
                }
            }
        }

        private fun num(): Any {
            val start = i
            if (s[i] == '-') i++
            while (i < s.length && (s[i].isDigit() || s[i] == '.' || s[i] == 'e' || s[i] == 'E' || s[i] == '+' || s[i] == '-')) i++
            val text = s.substring(start, i)
            return if (text.contains('.') || text.contains('e') || text.contains('E')) text.toDouble() else text.toLong()
        }
    }
}
